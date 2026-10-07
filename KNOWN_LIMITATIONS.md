# Known limitations

- Live provider calls have not been tested with real credentials. Offline tests validate the implemented contracts and failure behavior, not account access or the services themselves.
- Search-backed citations do not prove a statement true. There is no page reachability check, factual entailment model, independent crawler or source-quality score.
- Exact brand matching can confuse ordinary words with brands and cannot resolve subsidiaries or implicit references. Add aliases deliberately and inspect ambiguous answers. There is no sentiment or recommendation-strength analysis.
- A single, user-selected question set is not representative market research. Results are nondeterministic. Differences in provider search, models and partial coverage can confound comparisons. No trend, confidence interval or statistical significance is implied by the chart.
- Generated questions are English templates and may not fit every category. They remain editable; manually written questions can use other languages.
- OpenAI annotation spans and Perplexity source IDs are treated as provider contracts. Malformed, overlapping, ambiguous or unsupported citation formats reject the sample. New API formats may require adapter updates.
- A 60-second timeout or 4,096 output-token ceiling can exclude slow or long answers. Only one local run is allowed at a time. There is no background queue, durable checkpoint or resume.
- Short retry delays apply per job; concurrently active requests may still encounter the same rate limit. Long cooldowns and authentication failures stop queued calls for that provider, but do not undo in-flight requests.
- Retries and fallbacks may incur additional charges. Cancelling locally does not guarantee cancellation or refunds upstream. The app bounds attempts, not spend.
- The machine, browser extensions and API providers remain trusted parties. Memory-only handling does not protect against a compromised machine or guarantee secure memory erasure.
- Top sources shows the first 25 pages by answer count. Full normalized results remain in the JSON export. URLs are deduplicated after fragment and common tracking-parameter removal, not by canonical content identity.
- The page is designed for local desktop use and adapts to smaller screens. This release has not undergone a formal accessibility audit or a complete cross-browser test matrix.
