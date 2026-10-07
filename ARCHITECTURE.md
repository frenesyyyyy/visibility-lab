# Architecture

The browser owns the current report. A loopback-only Node server owns API credentials and bounded execution for the duration of a run. There is no persistent store.

```mermaid
flowchart LR
  A[Question set and provider selection] --> B[Local request validation]
  B --> C[Bounded worker pool]
  C --> D[Fixed provider endpoints]
  D --> E[Completion and citation checks]
  E --> F[Normalized results]
  F --> G[NDJSON events to browser]
  G --> H[Coverage, visibility and source table]
  H --> I[User-initiated JSON export]
```

## Boundaries

| File                | Responsibility                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `server.js`         | Static allowlist, local request checks, one active run, stream lifecycle and key cleanup |
| `lib/config.js`     | Bounds and public configuration without credentials                                      |
| `lib/providers.js`  | Fixed endpoint requests, safe transport errors and response byte limits                  |
| `lib/evidence.js`   | Completion, search and citation contract validation                                      |
| `lib/runner.js`     | Worker pool, retries, cancellation and fallback provenance                               |
| `public/metrics.js` | Deterministic mention matching and sample denominators                                   |
| `public/app.js`     | Form state, stream consumption and export                                                |
| `public/results.js` | SVG chart, source table and answer inspection                                            |
| `public/sample.js`  | Fictional offline illustration                                                           |

## A result

Each job has a stable ID from question index and requested provider. It settles once with `ok`, `failed` or `cancelled`. Successful results include answer text, validated citation spans, actual provider, returned model, mention result and elapsed time. A fallback keeps the requested provider and original failure code as well as the actual provider. Transport attempts do not create extra samples.

## Execution bounds

At most 30 questions and two providers are accepted. Concurrency is 1–4, default 3. Each provider attempt has a 60-second timeout; a whole run has a 15-minute deadline. A transient error permits at most three total attempts. Exponential delay includes jitter and respects `Retry-After` up to 15 seconds. A longer cooldown disables that provider for queued jobs for the rest of the run rather than retrying earlier than instructed. Rejected credentials also disable queued calls to that provider. Already-active calls can finish.

Fallback is opt-in. It tries the other selected provider once through that provider's bounded retry policy. There are no fallback cycles. Sixty primary jobs with fallback could therefore make up to 360 upstream attempts; the UI shows the bound before starting. This is an attempt bound, not a monetary cap or a bound on the provider's internal tool calls.

The response connection carries newline-delimited JSON events. Disconnecting aborts active requests and queued work. A streaming error does not discard answers already received. Reloading the page discards the browser report. There is no resume protocol.

## Local trust boundary

The server binds to `127.0.0.1`, checks Host and Origin, and requires a per-process random token on run requests. The token is obtained by the same-origin page. This prevents ordinary cross-origin web pages from starting billable work, but does not protect against local malware or another process with local access. There is no CORS grant. A strict content policy and text-node rendering prevent returned HTML from becoming active markup.

API endpoint URLs are fixed in code. Redirects are rejected. Key strings are not included in streamed configuration or exported reports, and a defensive redaction handles unexpected echoes in results. Secrets are released after a run; JavaScript does not guarantee erasure of prior memory copies. The server does not follow citation URLs or inspect the user's private platform files.
