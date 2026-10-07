export const PROVIDERS = ["openai", "perplexity"];
export const DEFAULT_MODEL = "gpt-4.1-mini";

export function validateConfig(value) {
  if (!value || typeof value !== "object")
    throw new Error("A run configuration is required.");
  const text = (v, label, max) => {
    if (typeof v !== "string" || !v.trim() || v.trim().length > max) {
      throw new Error(`${label} must contain 1–${max} characters.`);
    }
    return v.trim();
  };
  const brand = text(value.brand, "Brand", 100);
  const aliases = (value.aliases ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (aliases.length > 8 || aliases.some((s) => s.length > 100))
    throw new Error("Use up to eight short aliases.");
  if (
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    value.questions.length > 30
  ) {
    throw new Error("Use between 1 and 30 questions.");
  }
  const questions = value.questions.map((q) => text(q, "Each question", 1000));
  if (
    new Set(questions.map((q) => q.toLocaleLowerCase())).size !==
    questions.length
  ) {
    throw new Error("Remove duplicate questions before running.");
  }
  const providers = value.providers;
  if (
    !Array.isArray(providers) ||
    !providers.length ||
    providers.length > 2 ||
    new Set(providers).size !== providers.length ||
    providers.some((p) => !PROVIDERS.includes(p))
  ) {
    throw new Error("Select OpenAI, Perplexity, or both.");
  }
  const keys = {};
  for (const p of providers) {
    keys[p] = text(value.keys?.[p], `The ${p} key`, 512);
    if (/\s/.test(keys[p]) || keys[p].length < 8)
      throw new Error(`Check the ${p} key.`);
  }
  const model = text(value.model || DEFAULT_MODEL, "OpenAI model", 100);
  if (!/^[a-zA-Z0-9._:-]+$/.test(model))
    throw new Error("Use a valid OpenAI model ID.");
  const concurrency = Number(value.concurrency ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error("Parallel requests must be between 1 and 4.");
  return {
    brand,
    aliases,
    questions,
    providers: [...providers],
    keys,
    model,
    concurrency,
    fallback: value.fallback === true && providers.length === 2,
  };
}

export function publicConfig(config) {
  const { brand, aliases, questions, providers, model, concurrency, fallback } =
    config;
  return { brand, aliases, questions, providers, model, concurrency, fallback };
}
