import { normalizeAnswer, EvidenceError } from "./evidence.js";

export class RequestError extends Error {
  constructor(code, retryable = false, retryAfter = 0) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const number = Number(value);
  const ms = Number.isFinite(number) ? number * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export function buildRequest(provider, question, model) {
  const input = `Search the web to answer this question. Give a concise, evidence-based answer with inline source citations. If the evidence is insufficient, say so.\n\n${question}`;
  if (provider === "openai")
    return {
      url: "https://api.openai.com/v1/responses",
      body: {
        model,
        input,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        max_output_tokens: 4096,
        store: false,
      },
    };
  return {
    url: "https://api.perplexity.ai/v1/agent",
    body: { preset: "fast", input, max_output_tokens: 4096 },
  };
}

export async function requestAnswer(
  provider,
  question,
  config,
  signal,
  fetchImpl = fetch,
) {
  const { url, body } = buildRequest(provider, question, config.model);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.keys[provider]}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      const code = [401, 403].includes(status)
        ? "credentials"
        : status === 429
          ? "rate_limit"
          : status === 408
            ? "timeout"
            : status >= 500
              ? "upstream"
              : "request_rejected";
      throw new RequestError(
        code,
        status === 408 || status === 429 || status >= 500,
        retryAfterMs(response.headers.get("retry-after")),
      );
    }
    // Limit decoded bytes as well as tokens; an upstream error page must not exhaust memory.
    let size = 0;
    const chunks = [];
    if (!response.body) throw new RequestError("invalid_response");
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2_000_000) throw new RequestError("invalid_response");
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new RequestError("invalid_response");
    }
    try {
      return normalizeAnswer(provider, data);
    } catch (error) {
      throw new RequestError(
        error instanceof EvidenceError ? error.code : "invalid_response",
      );
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof RequestError) throw error;
    if (error instanceof EvidenceError) throw new RequestError(error.code);
    // Never surface provider response bodies or fetch errors: they can contain request secrets.
    throw new RequestError("network", true);
  }
}
