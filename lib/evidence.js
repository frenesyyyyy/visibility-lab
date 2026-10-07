import { isIP } from "node:net";

export function safeCitationURL(value) {
  try {
    if (typeof value !== "string" || value.length > 4096) return null;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    // Sources are links, never server-side fetch targets. Reject local and numeric hosts anyway.
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host) ||
      host.startsWith("[") ||
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["gclid", "fbclid"].includes(key))
        url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

export class EvidenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function answerParts(data) {
  if (data?.status !== "completed" || !Array.isArray(data.output))
    throw new EvidenceError("incomplete");
  const messages = data.output.filter(
    (x) => x.type === "message" && x.role === "assistant",
  );
  if (
    !messages.length ||
    messages.some((x) => x.status !== "completed" || !Array.isArray(x.content))
  ) {
    throw new EvidenceError("incomplete");
  }
  const content = messages.flatMap((x) => x.content);
  if (content.some((x) => x.type === "refusal"))
    throw new EvidenceError("refused");
  const parts = content.filter((x) => x.type === "output_text");
  if (
    !parts.length ||
    parts.some((x) => typeof x.text !== "string") ||
    !parts.some((x) => x.text.trim()) ||
    parts.reduce((n, x) => n + x.text.length, 0) > 60000
  ) {
    throw new EvidenceError("invalid_response");
  }
  return parts;
}

export function normalizeAnswer(provider, data) {
  const parts = answerParts(data);
  const text = parts.map((p) => p.text).join("\n\n");
  const citations = [];
  const add = (url, start, end, label) => {
    const safe = safeCitationURL(url);
    if (
      !safe ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length
    )
      throw new EvidenceError("invalid_citations");
    citations.push({ url: safe, start, end, label });
  };

  if (provider === "openai") {
    if (
      !data.output.some(
        (x) => x.type === "web_search_call" && x.status === "completed",
      )
    ) {
      throw new EvidenceError("no_search");
    }
    let offset = 0;
    for (const part of parts) {
      if (!Array.isArray(part.annotations))
        throw new EvidenceError("invalid_citations");
      for (const a of part.annotations) {
        if (a.type === "url_citation")
          add(a.url, offset + a.start_index, offset + a.end_index, "Source");
      }
      offset += part.text.length + 2;
    }
  } else {
    const sources = new Map();
    for (const item of data.output.filter((x) => x.type === "search_results")) {
      for (const source of item.results ?? []) {
        const id = String(source.id);
        if (sources.has(id) && sources.get(id) !== source.url)
          throw new EvidenceError("invalid_citations");
        sources.set(id, source.url);
      }
    }
    if (!sources.size) throw new EvidenceError("no_search");
    for (const match of text.matchAll(/\[(?:web:)?(\d+)\]/g)) {
      add(
        sources.get(match[1]),
        match.index,
        match.index + match[0].length,
        match[0],
      );
    }
  }
  citations.sort((a, b) => a.start - b.start || a.end - b.end);
  if (!citations.length) throw new EvidenceError("no_citations");
  // A malformed citation invalidates the sample instead of silently improving its score.
  if (citations.some((c, i) => i && c.start < citations[i - 1].end))
    throw new EvidenceError("invalid_citations");
  return {
    text,
    citations,
    model: typeof data.model === "string" ? data.model.slice(0, 100) : null,
  };
}
