export const fakeKey = "offline-fixture-not-a-real-credential";
export function openAI(
  text = "Northstar is an option. [1]",
  url = "https://example.com/guide",
) {
  return {
    status: "completed",
    model: "fixture-model",
    output: [
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: [
              {
                type: "url_citation",
                url,
                start_index: text.indexOf("[1]"),
                end_index: text.indexOf("[1]") + 3,
              },
            ],
          },
        ],
      },
    ],
  };
}
export function perplexity(text = "Northstar is an option. [1]") {
  return {
    status: "completed",
    model: "fixture-model",
    output: [
      {
        type: "search_results",
        results: [
          { id: 1, url: "https://example.com/guide" },
          { id: 2, url: "https://example.org/uncited" },
        ],
      },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}
export function config(overrides = {}) {
  return {
    brand: "Northstar",
    aliases: [],
    questions: [
      "Which installers should I compare?",
      "Who offers maintenance?",
    ],
    providers: ["openai", "perplexity"],
    keys: { openai: fakeKey, perplexity: fakeKey },
    model: "gpt-4.1-mini",
    concurrency: 3,
    fallback: false,
    ...overrides,
  };
}
