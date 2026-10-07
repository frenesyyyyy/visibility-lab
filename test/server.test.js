import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createApp } from "../server.js";
import { config, fakeKey, openAI, perplexity } from "./fixtures.js";
import { runBatch } from "../lib/runner.js";
import { requestAnswer } from "../lib/providers.js";
import { summarize } from "../public/metrics.js";

async function localServer(t, run) {
  const server = createApp({ run });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${origin}/session`)).json();
  const headers = {
    Origin: origin,
    "Content-Type": "application/json",
    "X-Session-Token": token,
  };
  return { origin, headers };
}
const payload = () => JSON.stringify(config({ aliases: "" }));

test("full HTTP stream preserves fallback provenance and report denominators", async (t) => {
  let upstreamCalls = 0;
  const mockFetch = async (url, options) => {
    upstreamCalls++;
    const question = JSON.parse(options.body).input;
    const data = url.includes("openai.com") ? openAI() : perplexity();
    if (url.includes("openai.com") && question.includes("maintenance"))
      data.status = "incomplete";
    return new Response(JSON.stringify(data));
  };
  const { origin, headers } = await localServer(t, (c, emit, signal) =>
    runBatch(c, emit, signal, {
      call: (p, q, value, abort) =>
        requestAnswer(p, q, value, abort, mockFetch),
    }),
  );
  const response = await fetch(`${origin}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(config({ aliases: "", fallback: true })),
  });
  const text = await response.text();
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events[0].type, "start");
  assert.equal(events.at(-1).type, "done");
  const results = events
    .filter((e) => e.type === "result")
    .map((e) => e.result);
  assert.equal(results.length, 4);
  assert.equal(upstreamCalls, 5);
  const report = summarize(events[0].config, results);
  assert.equal(report.valid, 3);
  assert.equal(report.planned, 4);
  assert.equal(report.fallbacks, 1);
  assert.equal(text.includes(fakeKey), false);
});

test("serves only allowlisted assets with restrictive browser headers", async (t) => {
  const { origin } = await localServer(t);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(await page.text(), /Visibility Lab/);
  assert.equal((await fetch(`${origin}/lib/providers.js`)).status, 404);
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
});

test("rejects cross-origin, missing token and forged Host before any run", async (t) => {
  let calls = 0;
  const { origin, headers } = await localServer(t, async () => {
    calls++;
  });
  for (const h of [
    { ...headers, Origin: "https://example.com" },
    { ...headers, "X-Session-Token": "wrong" },
    { ...headers, Host: "evil.example.com" },
    { ...headers, "Sec-Fetch-Site": "cross-site" },
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        `${origin}/run`,
        { method: "POST", headers: h },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on("error", reject);
      req.end(payload());
    });
    assert.equal(status, 403);
  }
  assert.equal(calls, 0);
});

test("bad input is rejected before provider calls, with no echoed credentials", async (t) => {
  let calls = 0;
  const { origin, headers } = await localServer(t, async () => {
    calls++;
  });
  for (const body of [
    "{broken",
    JSON.stringify(config({ questions: [], aliases: "" })),
    "x".repeat(65000),
  ]) {
    const response = await fetch(`${origin}/run`, {
      method: "POST",
      headers,
      body,
    });
    assert.ok([400, 413].includes(response.status));
    assert.equal((await response.text()).includes(fakeKey), false);
  }
  assert.equal(calls, 0);
});

test("stream redacts secrets and clears in-memory configuration after completion", async (t) => {
  let received;
  const { origin, headers } = await localServer(t, async (c, emit) => {
    received = c;
    emit({ type: "result", text: `Unexpected echo ${c.keys.openai}` });
    emit({ type: "done" });
  });
  const response = await fetch(`${origin}/run`, {
    method: "POST",
    headers,
    body: payload(),
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(fakeKey), false);
  assert.match(text, /redacted/);
  assert.equal(received.keys.openai, "");
  assert.equal(received.keys.perplexity, "");
});

test("only one local run may consume API budget at a time; disconnect aborts it", async (t) => {
  let started, ended;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  const end = new Promise((resolve) => {
    ended = resolve;
  });
  const { origin, headers } = await localServer(t, async (_c, emit, signal) => {
    emit({ type: "start" });
    started();
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
    ended();
  });
  const controller = new AbortController();
  const first = await fetch(`${origin}/run`, {
    method: "POST",
    headers,
    body: payload(),
    signal: controller.signal,
  });
  await start;
  const second = await fetch(`${origin}/run`, {
    method: "POST",
    headers,
    body: payload(),
  });
  assert.equal(second.status, 409);
  controller.abort();
  await assert.rejects(first.text());
  await end;
});
