import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateConfig } from "./lib/config.js";
import { runBatch } from "./lib/runner.js";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/metrics.js", ["metrics.js", "text/javascript; charset=utf-8"]],
  ["/results.js", ["results.js", "text/javascript; charset=utf-8"]],
  ["/sample.js", ["sample.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

export function createApp({ run = runBatch } = {}) {
  const token = randomBytes(32).toString("hex");
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.host !== origin.slice(7) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return json(403, { error: "Open the app at its printed local address." });
    if (req.method === "GET" && req.url === "/session")
      return json(200, { token });
    if (req.method === "GET" && assets.has(req.url)) {
      try {
        const [name, type] = assets.get(req.url);
        const data = await readFile(
          new URL(`./public/${name}`, import.meta.url),
        );
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      } catch {
        json(500, {
          error: "A local file is missing. Re-extract the project.",
        });
      }
      return;
    }
    if (req.method !== "POST" || req.url !== "/run")
      return json(404, { error: "Not found." });
    const supplied = Buffer.from(String(req.headers["x-session-token"] ?? ""));
    if (
      req.headers.origin !== origin ||
      supplied.length !== token.length ||
      !timingSafeEqual(supplied, Buffer.from(token))
    )
      return json(403, { error: "Reload the page before running." });
    if (req.headers["content-type"] !== "application/json")
      return json(415, { error: "Use JSON." });
    if (busy)
      return json(409, { error: "A run is already active in another tab." });
    busy = true;
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    let config;
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 64_000) {
          json(413, { error: "The configuration is too large." });
          return;
        }
        chunks.push(chunk);
      }
      try {
        config = validateConfig(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        json(400, {
          error:
            error instanceof SyntaxError
              ? "Invalid JSON."
              : "Check the brand, questions, keys and run settings.",
        });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const emit = (event) => {
        if (res.destroyed || controller.signal.aborted) return;
        const line = JSON.stringify(event);
        // Defensive redaction also covers an upstream answer that unexpectedly echoes a credential.
        let safe = line;
        for (const key of Object.values(config.keys)) {
          safe = safe
            .split(JSON.stringify(key).slice(1, -1))
            .join("[redacted]");
        }
        if (!res.write(safe + "\n") && res.writableLength > 2_000_000)
          controller.abort();
      };
      await run(config, emit, controller.signal);
      res.end();
    } catch {
      if (!res.headersSent) json(400, { error: "Could not read the request." });
      else if (!res.destroyed)
        res.end(
          JSON.stringify({
            type: "error",
            message:
              "The run stopped unexpectedly. Completed results are retained.",
          }) + "\n",
        );
    } finally {
      controller.abort();
      if (config)
        for (const key of Object.keys(config.keys)) config.keys[key] = "";
      busy = false;
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("PORT must be between 1024 and 65535.");
  const server = createApp();
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is in use. Set PORT to another local port.`
        : "The local server could not start.",
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Visibility Lab\nOpen http://127.0.0.1:${port}\nPress Ctrl+C to stop.`,
    ),
  );
}
