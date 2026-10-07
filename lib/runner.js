import { setTimeout as pause } from "node:timers/promises";
import { publicConfig } from "./config.js";
import { requestAnswer, RequestError } from "./providers.js";
import { scoreAnswer } from "../public/metrics.js";

export const POLICY = Object.freeze({
  attempts: 3,
  timeoutMs: 60_000,
  maxBackoffMs: 15_000,
  runMs: 15 * 60_000,
});

export async function runBatch(config, emit, outerSignal, options = {}) {
  const policy = { ...POLICY, ...options.policy };
  const call = options.call ?? requestAnswer;
  const sleep =
    options.sleep ?? ((ms, signal) => pause(ms, undefined, { signal }));
  const signal = AbortSignal.any([
    outerSignal,
    AbortSignal.timeout(policy.runMs),
  ]);
  const blocked = new Map();
  const jobs = config.questions.flatMap((question, questionIndex) =>
    config.providers.map((requestedProvider) => ({
      id: `${questionIndex}:${requestedProvider}`,
      question,
      questionIndex,
      requestedProvider,
    })),
  );
  const results = [];
  let cursor = 0;
  emit({
    type: "start",
    config: publicConfig(config),
    total: jobs.length,
    startedAt: new Date().toISOString(),
  });

  async function attempt(job, provider) {
    if (blocked.has(provider)) throw new RequestError(blocked.get(provider));
    for (let n = 1; n <= policy.attempts; n++) {
      signal.throwIfAborted();
      if (blocked.has(provider)) throw new RequestError(blocked.get(provider));
      emit({ type: "attempt", id: job.id, provider, attempt: n });
      const timeout = AbortSignal.timeout(policy.timeoutMs);
      try {
        const answer = await call(
          provider,
          job.question,
          config,
          AbortSignal.any([signal, timeout]),
        );
        signal.throwIfAborted();
        return { ...answer, attempts: n };
      } catch (error) {
        signal.throwIfAborted();
        const failure = timeout.aborted
          ? new RequestError("timeout", true)
          : error instanceof RequestError
            ? error
            : new RequestError("internal");
        if (
          failure.code === "credentials" ||
          failure.retryAfter > policy.maxBackoffMs
        )
          blocked.set(provider, failure.code);
        if (
          !failure.retryable ||
          n === policy.attempts ||
          failure.retryAfter > policy.maxBackoffMs
        )
          throw failure;
        const delay = Math.max(
          failure.retryAfter,
          Math.min(
            policy.maxBackoffMs,
            500 * 2 ** (n - 1) + Math.floor(Math.random() * 250),
          ),
        );
        emit({
          type: "retry",
          id: job.id,
          provider,
          delayMs: delay,
          reason: failure.code,
        });
        await sleep(delay, signal);
      }
    }
  }

  async function execute(job) {
    const started = Date.now();
    const base = {
      id: job.id,
      questionIndex: job.questionIndex,
      requestedProvider: job.requestedProvider,
    };
    let actualProvider = job.requestedProvider,
      fallback = false,
      primaryError = null;
    try {
      let answer;
      try {
        answer = await attempt(job, actualProvider);
      } catch (error) {
        signal.throwIfAborted();
        primaryError = error.code ?? "internal";
        if (!config.fallback) throw error;
        actualProvider = config.providers.find(
          (p) => p !== job.requestedProvider,
        );
        fallback = true;
        emit({
          type: "fallback",
          id: job.id,
          provider: actualProvider,
          reason: primaryError,
        });
        answer = await attempt(job, actualProvider);
      }
      const mentioned = scoreAnswer(answer, [config.brand, ...config.aliases]);
      return {
        ...base,
        actualProvider,
        fallback,
        primaryError,
        status: "ok",
        ...answer,
        mentioned,
        elapsedMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ...base,
        actualProvider,
        fallback,
        primaryError,
        status: signal.aborted ? "cancelled" : "failed",
        error: signal.aborted ? "cancelled" : (error.code ?? "internal"),
        elapsedMs: Date.now() - started,
      };
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, jobs.length) },
      async () => {
        while (cursor < jobs.length && !signal.aborted) {
          const result = await execute(jobs[cursor++]);
          results.push(result);
          emit({ type: "result", result });
        }
      },
    ),
  );
  for (const job of jobs.slice(cursor)) {
    const result = {
      id: job.id,
      questionIndex: job.questionIndex,
      requestedProvider: job.requestedProvider,
      actualProvider: job.requestedProvider,
      fallback: false,
      status: "cancelled",
      error: "cancelled",
      elapsedMs: 0,
    };
    results.push(result);
    emit({ type: "result", result });
  }
  emit({
    type: "done",
    cancelled: signal.aborted,
    completedAt: new Date().toISOString(),
  });
  return results;
}
