export const LABELS = { openai: "OpenAI", perplexity: "Perplexity" };

function wordsOnly(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function hasMention(text, names, includeLinks = false) {
  // Link destinations and citation markers are not brand mentions in the answer body.
  const body = wordsOnly(
    includeLinks
      ? text
      : text
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/https?:\/\/[^\s)\]]+/gi, "")
          .replace(/\[(?:web:)?\d+\]/g, ""),
  );
  return names.some((name) => {
    const term = wordsOnly(name.trim());
    if (!term) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "u",
    ).test(body);
  });
}

export function scoreAnswer(answer, names) {
  let body = "",
    last = 0;
  for (const c of answer.citations) {
    body += answer.text.slice(last, c.start);
    last = c.end;
  }
  body += answer.text.slice(last);
  return hasMention(body, names);
}

export function summarize(config, results) {
  const names = [config.brand, ...config.aliases];
  const eligible = config.questions.map((q) => !hasMention(q, names, true));
  const rows = config.providers.map((provider) => {
    const primary = results.filter(
      (r) =>
        r.requestedProvider === provider &&
        r.actualProvider === provider &&
        !r.fallback,
    );
    const valid = primary.filter(
      (r) => r.status === "ok" && eligible[r.questionIndex],
    );
    const mentions = valid.filter((r) => r.mentioned).length;
    const planned = eligible.filter(Boolean).length;
    return {
      provider,
      mentions,
      valid: valid.length,
      planned,
      rate: valid.length ? (mentions / valid.length) * 100 : null,
      coverage: planned ? (valid.length / planned) * 100 : null,
    };
  });
  const sourceMap = new Map();
  for (const r of results.filter(
    (r) => r.status === "ok" && !r.fallback && eligible[r.questionIndex],
  )) {
    for (const url of new Set(r.citations.map((c) => c.url))) {
      const source = sourceMap.get(url) ?? {
        url,
        count: 0,
        providers: new Set(),
      };
      source.count++;
      source.providers.add(r.actualProvider);
      sourceMap.set(url, source);
    }
  }
  return {
    rows,
    sources: [...sourceMap.values()]
      .map((s) => ({ ...s, providers: [...s.providers] }))
      .sort((a, b) => b.count - a.count || a.url.localeCompare(b.url)),
    prompted: eligible.filter((v) => !v).length,
    valid: rows.reduce((n, r) => n + r.valid, 0),
    planned: rows.reduce((n, r) => n + r.planned, 0),
    fallbacks: results.filter((r) => r.fallback && r.status === "ok").length,
  };
}
