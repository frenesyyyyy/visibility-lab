# Provider contracts

Reviewed on 7 October 2026. These are public API integrations; no consumer chat session or private product endpoint is used.

| Provider   | Endpoint                                   | Request                                                                | Evidence required                                                                                               |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| OpenAI     | `POST https://api.openai.com/v1/responses` | Configurable model; `web_search`; required tool choice; `store: false` | Completed response and assistant message, completed `web_search_call`, valid `url_citation` annotations         |
| Perplexity | `POST https://api.perplexity.ai/v1/agent`  | `preset: fast`                                                         | Completed response and assistant message, `search_results`, numbered citations resolving to returned source IDs |

Both adapters request at most 4,096 output tokens and do not stream the upstream response. The local server emits one normalized result event as each answer settles. A provider's output may change; unsupported evidence is excluded instead of guessed.

OpenAI annotations refer to spans in the returned text. Perplexity's `[n]` and `[web:n]` markers refer to result IDs. Search results with no citation in the answer are not included in the top-sources table. The app links the original citation markers in the answer inspector.

The measured brand is not inserted into provider instructions. The exact user-reviewed question is included along with a brief instruction to search, cite and acknowledge insufficient evidence.

## Official references

- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search): tool configuration, citation annotations and required tool choice.
- [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini): model details and availability.
- [Perplexity migration overview](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview): current Agent API endpoint and migration away from Sonar.
- [Perplexity migration procedure](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to): output structure, citation markers and result IDs.
- [Perplexity presets](https://docs.perplexity.ai/docs/agent-api/presets): fast preset and output controls.

The fixtures in the tests are hand-written examples of these contracts. They are not recordings of successful live requests. A future live validation should use a small, explicitly funded question set and record the returned model and actual failures before making compatibility claims.
