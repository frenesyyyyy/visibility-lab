import { LABELS, summarize } from "./metrics.js";
import { ERRORS, drawChart, renderSources, renderAnswers } from "./results.js";
import { sampleRun } from "./sample.js";

const $ = (id) => document.getElementById(id);
let config,
  results = [],
  isSample = true,
  running = false,
  controller = null,
  startedAt = null,
  completedAt = null;
let stopRequested = false;

function questions() {
  return $("questions")
    .value.split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
}
function selectedProviders() {
  return ["openai", "perplexity"].filter((p) => $(`use-${p}`).checked);
}
function updateEstimate() {
  const count = questions().length,
    providers = selectedProviders().length;
  $("question-count").textContent =
    `${count} question${count === 1 ? "" : "s"}`;
  const attempts =
    count * providers * 3 * ($("fallback").checked && providers === 2 ? 2 : 1);
  $("run-estimate").textContent =
    `${count * providers} primary requests · up to ${attempts} API attempts`;
  for (const provider of ["openai", "perplexity"])
    $(`key-${provider}`).disabled = running || !$(`use-${provider}`).checked;
}

function generateQuestions() {
  const count = Number($("count").value),
    category = $("category").value.trim(),
    market = $("market").value.trim();
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 30 ||
    !category ||
    !market
  ) {
    showError(
      "Enter a category, market and a question count between 1 and 30.",
    );
    return;
  }
  const intents = [
    `Which ${category} should a customer compare in ${market}?`,
    `Which ${category} offer strong after-sales support in ${market}?`,
    `What are the best-value options for ${category} in ${market}?`,
    `Which ${category} offer the clearest pricing in ${market}?`,
    `Which ${category} have well-documented customer reviews in ${market}?`,
    `Which ${category} are suitable for a first-time buyer in ${market}?`,
    `Which ${category} offer flexible payment options in ${market}?`,
    `Which ${category} provide comprehensive warranties in ${market}?`,
    `Which ${category} are suitable for a small project in ${market}?`,
    `Which ${category} provide long-term maintenance in ${market}?`,
  ];
  const generated = Array.from(
    { length: count },
    (_, i) =>
      intents[i % 10] +
      (i < 10
        ? ""
        : i < 20
          ? " Prioritize a customer with a limited budget."
          : " Prioritize a customer who values long-term service."),
  );
  $("questions").value = generated.join("\n");
  showError("");
  updateEstimate();
}

function showError(message) {
  $("form-error").textContent = message;
  $("form-error").hidden = !message;
}
function setRunning(value) {
  running = value;
  $("settings").disabled = value;
  $("run").disabled = value;
  $("example").disabled = value;
  $("stop").hidden = !value;
  $("run").textContent = value ? "Analysis running…" : "Run analysis →";
  updateEstimate();
}

function render() {
  const summary = summarize(config, results),
    total = config.questions.length * config.providers.length;
  $("coverage-value").textContent = `${summary.valid} / ${summary.planned}`;
  $("coverage-caption").textContent = summary.prompted
    ? `${summary.prompted} brand-prompted questions excluded`
    : "Eligible answers / planned samples";
  $("sources-value").textContent = summary.sources.length;
  $("fallback-value").textContent = summary.fallbacks;
  $("chart-brand").textContent = config.brand;
  $("progress").max = total;
  $("progress").value = results.length;
  $("progress-label").textContent = `${results.length} / ${total} answers`;
  $("export").disabled = !results.length;
  drawChart(summary.rows);
  renderSources(config, results);
  renderAnswers(config, results);
}

function loadExample(scroll = true) {
  ({ config, results } = sampleRun());
  isSample = true;
  startedAt = null;
  completedAt = null;
  $("run-status").textContent =
    "Illustrative example · Northstar · fictional answers and source links · no API calls";
  render();
  if (scroll) $("results").scrollIntoView({ behavior: "smooth" });
}

function acceptEvent(event) {
  if (event.type === "start") {
    config = event.config;
    startedAt = event.startedAt;
    results = [];
    render();
  } else if (event.type === "result") {
    results = results.filter((r) => r.id !== event.result.id);
    results.push(event.result);
    render();
    $("run-status").textContent =
      `Running · ${config.brand} · ${results.length} answers received`;
  } else if (event.type === "retry") {
    $("run-status").textContent =
      `${LABELS[event.provider]} · retrying after ${ERRORS[event.reason]?.toLowerCase() ?? "a temporary error"}`;
  } else if (event.type === "fallback") {
    $("run-status").textContent =
      `Trying ${LABELS[event.provider]} as fallback · kept separate from the comparison`;
  } else if (event.type === "done") {
    completedAt = event.completedAt;
    $("run-status").textContent =
      `${event.cancelled ? "Stopped; partial results retained" : "Analysis complete"} · ${config.brand} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } else if (event.type === "error") throw new Error(event.message);
}

async function startRun(event) {
  event.preventDefault();
  if (running) return;
  const selected = selectedProviders(),
    list = questions();
  if (!selected.length || !list.length || list.length > 30) {
    showError("Select a provider and enter 1–30 questions.");
    return;
  }
  if (new Set(list.map((q) => q.toLowerCase())).size !== list.length) {
    showError("Remove duplicate questions before running.");
    return;
  }
  if (list.some((q) => q.length > 1000)) {
    showError("Keep each question under 1,000 characters.");
    return;
  }
  if (selected.some((p) => $(`key-${p}`).value.trim().length < 8)) {
    showError(
      "Enter a key for each selected provider, or explore the offline example.",
    );
    return;
  }
  const payload = {
    brand: $("brand").value.trim(),
    aliases: $("aliases").value,
    questions: list,
    providers: selected,
    model: $("model").value.trim(),
    concurrency: Number($("concurrency").value),
    fallback: $("fallback").checked,
    keys: Object.fromEntries(
      selected.map((p) => [p, $(`key-${p}`).value.trim()]),
    ),
  };
  setRunning(true);
  showError("");
  stopRequested = false;
  controller = new AbortController();
  try {
    const sessionResponse = await fetch("/session", {
      signal: controller.signal,
    });
    if (!sessionResponse.ok)
      throw new Error(
        "Could not connect to the local server. Restart it and reload.",
      );
    const session = await sessionResponse.json();
    const request = fetch("/run", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": session.token,
      },
      body: JSON.stringify(payload),
    });
    for (const key of Object.keys(payload.keys)) payload.keys[key] = "";
    for (const p of ["openai", "perplexity"]) $(`key-${p}`).value = "";
    const response = await request;
    if (!response.ok) {
      const failure = await response.json();
      throw new Error(failure.error || "The local server rejected this run.");
    }
    isSample = false;
    results = [];
    completedAt = null;
    $("run-status").textContent = "Starting analysis…";
    $("results").scrollIntoView({ behavior: "smooth" });
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "",
      doneSeen = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const item = JSON.parse(line);
        acceptEvent(item);
        if (item.type === "done") doneSeen = true;
      }
    }
    if (buffer.trim() || !doneSeen)
      throw new Error(
        "The connection closed early. Completed answers are retained.",
      );
  } catch (error) {
    const message = stopRequested
      ? "Stopped. Completed answers are retained; interrupted requests may still be billed."
      : error instanceof TypeError
        ? "Could not reach the local server. Completed results are retained."
        : error.message;
    $("run-status").textContent = message;
    if (!stopRequested) showError(message);
  } finally {
    for (const key of Object.keys(payload.keys)) payload.keys[key] = "";
    controller = null;
    setRunning(false);
  }
}

$("generate").addEventListener("click", generateQuestions);
$("example").addEventListener("click", () => loadExample());
$("run-form").addEventListener("submit", startRun);
$("stop").addEventListener("click", () => {
  stopRequested = true;
  controller?.abort();
});
for (const id of ["questions", "use-openai", "use-perplexity", "fallback"])
  $(id).addEventListener("input", updateEstimate);
$("source-provider").addEventListener("change", () =>
  renderSources(config, results),
);
$("export").addEventListener("click", () => {
  const data = {
    formatVersion: 1,
    example: isSample,
    startedAt,
    completedAt,
    partial: running || (!isSample && !completedAt),
    config,
    results,
    summary: summarize(config, results),
    methodology:
      "Visibility is exact brand/alias mention rate in complete, citation-validated primary answers to unbranded questions. Fallbacks and failures are excluded. Citation checks do not prove factual support or page availability.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `visibility-lab-${isSample ? "example" : new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
new ResizeObserver(() => {
  if (config) drawChart(summarize(config, results).rows);
}).observe($("chart"));
generateQuestions();
loadExample(false);
