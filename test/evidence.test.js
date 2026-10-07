import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer, safeCitationURL } from "../lib/evidence.js";
import { hasMention, scoreAnswer, summarize } from "../public/metrics.js";
import { validateConfig, publicConfig } from "../lib/config.js";
import { openAI, perplexity, config, fakeKey } from "./fixtures.js";

test("OpenAI requires both completed search and citation metadata", () => {
  const answer = normalizeAnswer("openai", openAI());
  assert.equal(answer.citations[0].url, "https://example.com/guide");
  assert.equal(scoreAnswer(answer, ["Northstar"]), true);
  const noSearch = openAI();
  noSearch.output.shift();
  assert.throws(() => normalizeAnswer("openai", noSearch), /no_search/);
});

test("partial answers, refusals and malformed metadata are excluded", () => {
  const partial = openAI();
  partial.status = "incomplete";
  assert.throws(() => normalizeAnswer("openai", partial), /incomplete/);
  const refused = openAI();
  refused.output[1].content.push({ type: "refusal" });
  assert.throws(() => normalizeAnswer("openai", refused), /refused/);
  const invalid = openAI();
  invalid.output[1].content[0].annotations[0].end_index = 999;
  assert.throws(() => normalizeAnswer("openai", invalid), /invalid_citations/);
  const noCitations = openAI();
  noCitations.output[1].content[0].annotations = [];
  assert.throws(() => normalizeAnswer("openai", noCitations), /no_citations/);
});

test("Perplexity maps cited IDs, never every search result", () => {
  const result = normalizeAnswer("perplexity", perplexity());
  assert.deepEqual(
    result.citations.map((c) => c.url),
    ["https://example.com/guide"],
  );
  assert.equal(
    normalizeAnswer("perplexity", perplexity("Other answer. [web:1]")).citations
      .length,
    1,
  );
  assert.throws(
    () => normalizeAnswer("perplexity", perplexity("Unknown. [9]")),
    /invalid_citations/,
  );
  assert.throws(
    () => normalizeAnswer("perplexity", perplexity("No citations.")),
    /no_citations/,
  );
});

test("conflicting source IDs and overlapping annotations invalidate the sample", () => {
  const conflict = perplexity();
  conflict.output[0].results.push({ id: 1, url: "https://example.net/" });
  assert.throws(
    () => normalizeAnswer("perplexity", conflict),
    /invalid_citations/,
  );
  const overlap = openAI();
  overlap.output[1].content[0].annotations.push({
    ...overlap.output[1].content[0].annotations[0],
  });
  assert.throws(() => normalizeAnswer("openai", overlap), /invalid_citations/);
});

test("source URLs exclude scripts, credentials, local destinations and IP literals", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,a",
    "file:///etc/passwd",
    "https://localhost/a",
    "http://127.1/a",
    "http://2130706433/a",
    "http://[::1]/",
    "http://host.local/a",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "https://10.0.0.1/",
  ])
    assert.equal(safeCitationURL(value), null, value);
  assert.equal(
    safeCitationURL("https://example.com/a?id=2&utm_source=ai#part"),
    "https://example.com/a?id=2",
  );
});

test("mentions use Unicode word boundaries and aliases, ignoring URL destinations", () => {
  assert.equal(hasMention("A shellfish supplier.", ["Shell"]), false);
  assert.equal(hasMention("SHELL is mentioned.", ["Shell"]), true);
  assert.equal(hasMention("éShell is a different word.", ["Shell"]), false);
  assert.equal(
    hasMention("Ｎｏｒｔｈｓｔａｒ is an option.", ["Northstar"]),
    true,
  );
  assert.equal(
    hasMention("See https://northstar.example.com [1].", ["Northstar"]),
    false,
  );
  assert.equal(
    hasMention("Compare https://northstar.example.com", ["Northstar"], true),
    true,
  );
  assert.equal(
    hasMention("[Northstar](https://example.com).", ["Northstar"]),
    true,
  );
  assert.equal(hasMention("ACME+ is here.", ["ACME+"]), true);
  assert.equal(
    hasMention("NS Energy is here.", ["Northstar", "NS Energy"]),
    true,
  );
});

test("citation labels do not count as mentions", () => {
  const answer = {
    text: "A local installer. Northstar",
    citations: [{ start: 19, end: 28 }],
  };
  assert.equal(scoreAnswer(answer, ["Northstar"]), false);
});

test("metrics exclude failures, fallback answers and branded questions", () => {
  const c = config({
    questions: ["Who should I compare?", "Is Northstar good?"],
  });
  const a = normalizeAnswer("openai", openAI());
  const result = (provider, index, overrides = {}) => ({
    ...a,
    id: `${index}:${provider}`,
    questionIndex: index,
    requestedProvider: provider,
    actualProvider: provider,
    status: "ok",
    mentioned: true,
    fallback: false,
    ...overrides,
  });
  const summary = summarize(c, [
    result("openai", 0),
    result("openai", 1),
    result("perplexity", 0, { actualProvider: "openai", fallback: true }),
    result("perplexity", 1, { status: "failed" }),
  ]);
  assert.equal(summary.rows[0].rate, 100);
  assert.equal(summary.rows[0].valid, 1);
  assert.equal(summary.rows[1].rate, null);
  assert.equal(summary.sources[0].count, 1);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.prompted, 1);
});

test("a genuine absence is zero, an unmeasured provider is null", () => {
  const summary = summarize(config(), [
    {
      questionIndex: 0,
      requestedProvider: "openai",
      actualProvider: "openai",
      status: "ok",
      mentioned: false,
      fallback: false,
      citations: [],
    },
  ]);
  assert.equal(summary.rows[0].rate, 0);
  assert.equal(summary.rows[1].rate, null);
});

test("repeated citations count once per page per answer", () => {
  const summary = summarize(config(), [
    {
      questionIndex: 0,
      requestedProvider: "openai",
      actualProvider: "openai",
      status: "ok",
      mentioned: false,
      fallback: false,
      citations: [
        { url: "https://example.com/" },
        { url: "https://example.com/" },
      ],
    },
  ]);
  assert.equal(summary.sources[0].count, 1);
});

test("configuration is bounded, deduplicated and cannot select arbitrary endpoints", () => {
  const value = config({ aliases: " NS Energy, North Star " });
  assert.deepEqual(validateConfig(value).aliases, ["NS Energy", "North Star"]);
  assert.throws(
    () => validateConfig({ ...value, questions: ["Same", "same"] }),
    /duplicate/,
  );
  assert.throws(
    () => validateConfig({ ...value, questions: Array(31).fill("x") }),
    /30/,
  );
  assert.throws(
    () => validateConfig({ ...value, providers: ["evil"] }),
    /Select/,
  );
  assert.throws(
    () => validateConfig({ ...value, concurrency: 99 }),
    /Parallel/,
  );
  assert.throws(
    () => validateConfig({ ...value, model: "https://evil.com" }),
    /model ID/,
  );
  assert.equal(
    JSON.stringify(publicConfig(validateConfig(value))).includes(fakeKey),
    false,
  );
});
