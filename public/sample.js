// Deliberately fictional fixtures: opening the example never contacts an API.
export function sampleRun() {
  const questions = [
    "Which residential solar installers should a homeowner compare in Germany?",
    "Which residential solar installers offer strong after-sales support in Germany?",
    "Which companies offer solar panels with battery storage in Germany?",
    "What are the options for financing a home solar installation in Germany?",
    "Which solar installers offer transparent pricing in Germany?",
    "Which solar installers manage permits for homeowners in Germany?",
    "Which solar installers offer energy monitoring in Germany?",
    "Which companies offer solar and heat pump packages in Germany?",
    "Which solar providers are suitable for a small roof in Germany?",
    "Which solar installers offer long-term maintenance in Germany?",
  ];
  const urls = [
    "https://example.org/solar/homeowner-guide",
    "https://example.com/research/installer-comparison",
    "https://example.net/energy/battery-storage",
    "https://example.org/solar/financing",
    "https://example.com/research/home-energy",
  ];
  const results = [];
  for (let i = 0; i < questions.length; i++) {
    for (const p of ["openai", "perplexity"]) {
      const fallback = i === 8 && p === "perplexity";
      const mentioned = p === "openai" ? i < 7 : i < 5;
      const actualProvider = fallback ? "openai" : p;
      const base = {
        id: `${i}:${p}`,
        questionIndex: i,
        requestedProvider: p,
        actualProvider,
        fallback,
        elapsedMs: 2400 + i * 610,
      };
      if (i === 9 && p === "perplexity") {
        results.push({ ...base, status: "failed", error: "rate_limit" });
        continue;
      }
      const text = mentioned
        ? "Illustrative answer: Northstar appears among the options a homeowner might compare. Service coverage and installation terms still need checking against the cited material. [1] [2]"
        : "Illustrative answer: a homeowner might compare regional installers by service coverage, installation terms and ongoing support. No target-brand mention is present in this example. [1] [2]";
      results.push({
        ...base,
        status: "ok",
        mentioned,
        text,
        model: "illustrative-fixture",
        attempts: 1,
        primaryError: fallback ? "timeout" : null,
        citations: [1, 2].map((n, j) => ({
          url: urls[(i + j) % urls.length],
          label: `[${n}]`,
          start: text.indexOf(`[${n}]`),
          end: text.indexOf(`[${n}]`) + 3,
        })),
      });
    }
  }
  return {
    config: {
      brand: "Northstar",
      aliases: [],
      questions,
      providers: ["openai", "perplexity"],
      model: "gpt-4.1-mini",
      concurrency: 3,
      fallback: true,
    },
    results,
  };
}
