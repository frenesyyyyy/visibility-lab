# Development notes

Run `npm test` before changing evidence parsing, scheduling or metrics. Run `npm run check` for syntax checks. Tests use injected transports and a loopback server; they do not load API keys from environment variables or make provider requests.

The main invariants are:

1. A primary question/provider pair settles once, regardless of retries.
2. A failed or ungrounded response cannot become an observed brand absence.
3. A fallback never changes the identity of the requested provider.
4. Exports, event payloads and errors must not include credentials.
5. Source links come from validated provider evidence, not arbitrary prose URLs.

The tests exercise these boundaries with transient failures, invalid source IDs, incomplete answers, duplicate citations, cancellation and rejected credentials. Server tests check local request protection, the static allowlist, response redaction and single-run concurrency.

For a new provider, start with its documented response contract and synthetic fixtures. Keep transport errors separate from missing evidence. Do not add heuristics that turn unknown citation formats into success. Update the provider notes and limitations when a contract changes.

Comments explain non-obvious decisions, such as excluding missing evidence and not fetching arbitrary source URLs. Avoid narrating straightforward statements or recording development phases in source code.

This repository was built with AI assistance. Offline tests and source review are evidence of specific checks; they are not a substitute for live API validation or a claim of production readiness.
