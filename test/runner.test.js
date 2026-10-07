import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { runBatch } from "../lib/runner.js";
import {
  RequestError,
  buildRequest,
  requestAnswer,
  retryAfterMs,
} from "../lib/providers.js";
import { normalizeAnswer } from "../lib/evidence.js";
import { config, openAI, perplexity, fakeKey } from "./fixtures.js";

const answer = normalizeAnswer("openai", openAI());
const alive = () => new AbortController().signal;

test("bounded pool preserves unique jobs and never exceeds concurrency", async () => {
  let active = 0,
    peak = 0;
  const results = await runBatch(
    config({ concurrency: 2 }),
    () => {},
    alive(),
    {
      call: async () => {
        active++;
        peak = Math.max(peak, active);
        await pause(5);
        active--;
        return answer;
      },
    },
  );
  assert.equal(peak, 2);
  assert.equal(results.length, 4);
  assert.equal(new Set(results.map((r) => r.id)).size, 4);
  assert.ok(results.every((r) => r.mentioned));
});

test("transient errors retry within budget and respect Retry-After", async () => {
  let calls = 0;
  const delays = [];
  const results = await runBatch(
    config({ providers: ["openai"], questions: ["Question?"] }),
    () => {},
    alive(),
    {
      call: async () => {
        if (++calls < 3) throw new RequestError("rate_limit", true, 1000);
        return answer;
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    },
  );
  assert.equal(calls, 3);
  assert.equal(results[0].status, "ok");
  assert.ok(delays.every((ms) => ms >= 1000));
});

test("long provider cooldowns are not shortened to force another request", async () => {
  let calls = 0;
  const results = await runBatch(
    config({ providers: ["openai"], concurrency: 1 }),
    () => {},
    alive(),
    {
      call: async () => {
        calls++;
        throw new RequestError("rate_limit", true, 60000);
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(results[0].error, "rate_limit");
});

test("rejected credentials block queued requests without repeating authentication failures", async () => {
  let calls = 0;
  const results = await runBatch(
    config({ providers: ["openai"], concurrency: 1 }),
    () => {},
    alive(),
    {
      call: async () => {
        calls++;
        throw new RequestError("credentials");
      },
    },
  );
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.error === "credentials"));
});

test("fallback retains requested and actual providers and the original failure", async () => {
  const events = [];
  const results = await runBatch(
    config({ questions: ["Question?"], fallback: true }),
    (e) => events.push(e),
    alive(),
    {
      call: async (p) => {
        if (p === "openai") throw new RequestError("no_citations");
        return answer;
      },
    },
  );
  const recovered = results.find((r) => r.requestedProvider === "openai");
  assert.equal(recovered.actualProvider, "perplexity");
  assert.equal(recovered.fallback, true);
  assert.equal(recovered.primaryError, "no_citations");
  assert.equal(recovered.status, "ok");
  assert.equal(JSON.stringify(events).includes(fakeKey), false);
});

test("stop aborts active work and settles queued samples as cancelled", async () => {
  const controller = new AbortController();
  let calls = 0;
  const results = await runBatch(
    config({ concurrency: 1 }),
    () => {},
    controller.signal,
    {
      call: async (_p, _q, _c, signal) => {
        calls++;
        controller.abort();
        await pause(100, undefined, { signal });
        return answer;
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.status === "cancelled"));
});

test("timeouts are bounded and retry only within the attempt budget", async () => {
  let calls = 0;
  const results = await runBatch(
    config({ providers: ["openai"], questions: ["Question?"] }),
    () => {},
    alive(),
    {
      policy: { timeoutMs: 5, attempts: 2 },
      sleep: async () => {},
      call: async (_p, _q, _c, signal) => {
        calls++;
        await pause(100, undefined, { signal });
        return answer;
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(results[0].error, "timeout");
});

test("transport builds documented endpoints without adding the measured brand", async () => {
  const seen = [];
  const mockFetch = async (url, options) => {
    seen.push({ url, options });
    return new Response(
      JSON.stringify(url.includes("openai") ? openAI() : perplexity()),
    );
  };
  await requestAnswer(
    "openai",
    "Which installers?",
    config(),
    alive(),
    mockFetch,
  );
  await requestAnswer(
    "perplexity",
    "Which installers?",
    config(),
    alive(),
    mockFetch,
  );
  assert.equal(seen[0].url, "https://api.openai.com/v1/responses");
  assert.equal(seen[1].url, "https://api.perplexity.ai/v1/agent");
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(JSON.parse(seen[0].options.body).tool_choice, "required");
  assert.equal(JSON.parse(seen[0].options.body).store, false);
  assert.equal(
    JSON.stringify(seen.map((r) => r.options.body)).includes("Northstar"),
    false,
  );
  assert.equal(buildRequest("perplexity", "Q", "").body.preset, "fast");
});

test("transport error bodies and thrown fetch messages never escape", async () => {
  await assert.rejects(
    requestAnswer(
      "openai",
      "Q",
      config(),
      alive(),
      async () => new Response(fakeKey, { status: 401 }),
    ),
    (error) => error.code === "credentials" && !error.message.includes(fakeKey),
  );
  await assert.rejects(
    requestAnswer("openai", "Q", config(), alive(), async () => {
      throw new Error(fakeKey);
    }),
    (error) => error.code === "network" && !error.message.includes(fakeKey),
  );
  await assert.rejects(
    requestAnswer(
      "openai",
      "Q",
      config(),
      alive(),
      async () => new Response("<html>error</html>"),
    ),
    (error) => error.code === "invalid_response",
  );
});

test("response size limit rejects oversized upstream payloads", async () => {
  await assert.rejects(
    requestAnswer(
      "openai",
      "Q",
      config(),
      alive(),
      async () => new Response("x".repeat(2_000_001)),
    ),
    (error) => error.code === "invalid_response",
  );
});

test("Retry-After supports seconds, HTTP dates and malformed values", () => {
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(
    retryAfterMs(
      "Wed, 21 Oct 2015 07:28:00 GMT",
      Date.parse("2015-10-21T07:27:58Z"),
    ),
    2000,
  );
  assert.equal(retryAfterMs("garbage"), 0);
  assert.equal(retryAfterMs("-2"), 0);
});
