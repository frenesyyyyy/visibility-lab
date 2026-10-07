import { LABELS, summarize, hasMention } from "./metrics.js";

const $ = (id) => document.getElementById(id);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export const ERRORS = {
  credentials: "Key rejected or access not available",
  rate_limit: "Provider rate limit",
  timeout: "Request timed out",
  upstream: "Provider unavailable",
  network: "Connection failed",
  request_rejected:
    "Provider rejected the request; check model and account access",
  no_search: "No search evidence returned",
  no_citations: "No source citations returned",
  invalid_citations: "Citation metadata did not validate",
  incomplete: "Incomplete answer",
  refused: "Provider declined to answer",
  invalid_response: "Unexpected response format",
  internal: "The request could not be completed",
  cancelled: "Not measured: run stopped",
};
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function drawChart(rows) {
  const container = $("chart");
  const width = Math.max(250, container.clientWidth),
    barWidth = width - 63;
  const height = rows.length * 80 + 52;
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    class: "chart-svg",
    "aria-hidden": "true",
  });
  const defs = svgNode("defs");
  for (const [id, start, end] of [
    ["blue", "#4c95ff", "#1763db"],
    ["slate", "#86a4ce", "#456da6"],
  ]) {
    const gradient = svgNode("linearGradient", {
      id: `bar-${id}`,
      x1: "0%",
      x2: "100%",
    });
    gradient.append(
      svgNode("stop", { offset: "0%", "stop-color": start }),
      svgNode("stop", { offset: "100%", "stop-color": end }),
    );
    defs.append(gradient);
  }
  svg.append(defs);
  for (let step = 0; step <= 4; step++) {
    const x = (barWidth * step) / 4;
    svg.append(
      svgNode("line", {
        x1: x,
        x2: x,
        y1: 29,
        y2: height - 28,
        stroke: "#e0e6ef",
        "stroke-width": 1,
        "stroke-dasharray": "3 5",
      }),
    );
    svg.append(
      svgNode(
        "text",
        {
          x,
          y: height - 8,
          "text-anchor": step === 0 ? "start" : step === 4 ? "end" : "middle",
          fill: "#8590a0",
          "font-size": 10,
        },
        `${step * 25}%`,
      ),
    );
  }
  const descriptions = [];
  rows.forEach((row, index) => {
    const y = index * 80 + 20;
    const percentage = row.rate === null ? "—" : `${Math.round(row.rate)}%`;
    const group = svgNode("g");
    const description = `${LABELS[row.provider]}: ${row.rate === null ? "not measured" : percentage + " visibility"}, ${row.mentions} mentions in ${row.valid} eligible answers; ${row.valid} of ${row.planned} samples measured.`;
    descriptions.push(description);
    group.append(svgNode("title", {}, description));
    group.append(
      svgNode(
        "text",
        { x: 0, y, fill: "#283449", "font-size": 12, "font-weight": 550 },
        LABELS[row.provider],
      ),
    );
    group.append(
      svgNode(
        "text",
        {
          x: barWidth,
          y,
          fill: "#728097",
          "font-size": 10,
          "text-anchor": "end",
        },
        `${row.mentions} / ${row.valid} mentions`,
      ),
    );
    group.append(
      svgNode("rect", {
        x: 0,
        y: y + 12,
        width: barWidth,
        height: 25,
        rx: 4,
        fill: "#e6ebf3",
      }),
    );
    if (row.rate !== null && row.rate > 0)
      group.append(
        svgNode("rect", {
          x: 0,
          y: y + 12,
          width: (barWidth * row.rate) / 100,
          height: 25,
          rx: 4,
          fill: `url(#bar-${row.provider === "openai" ? "blue" : "slate"})`,
        }),
      );
    group.append(
      svgNode(
        "text",
        {
          x: width,
          y: y + 31,
          fill: "#25374f",
          "font-size": 19,
          "font-weight": 600,
          "text-anchor": "end",
        },
        percentage,
      ),
    );
    svg.append(group);
  });
  container.replaceChildren(svg);
  container.setAttribute("aria-label", descriptions.join(" "));
  container.removeAttribute("aria-labelledby");
  $("chart-detail").replaceChildren(
    ...rows.map((r) =>
      element(
        "span",
        `${LABELS[r.provider]} coverage: ${r.valid}/${r.planned} eligible samples${r.coverage === null ? "" : ` (${Math.round(r.coverage)}%)`}`,
      ),
    ),
  );
}

export function renderSources(config, results) {
  const provider = $("source-provider").value;
  const filtered =
    provider === "all"
      ? results
      : results.filter((r) => r.actualProvider === provider);
  const sources = summarize(config, filtered).sources;
  const rows = sources.slice(0, 25).map((s, i) => {
    const row = element("tr");
    const cell = element("td");
    const link = element(
      "a",
      `${new URL(s.url).host}${new URL(s.url).pathname}${new URL(s.url).search} ↗`,
    );
    link.href = s.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    cell.append(link);
    row.append(
      element("td", String(i + 1).padStart(2, "0")),
      cell,
      element("td", s.count, "numeric"),
      element(
        "td",
        s.providers.map((p) => LABELS[p]).join(" · "),
        "source-provider-label",
      ),
    );
    return row;
  });
  if (!rows.length) {
    const row = element("tr"),
      cell = element(
        "td",
        "No cited sources in eligible answers yet.",
        "empty-state",
      );
    cell.colSpan = 4;
    row.append(cell);
    rows.push(row);
  }
  $("sources-body").replaceChildren(...rows);
}

function answerBody(result) {
  const body = element("p", undefined, "answer-body");
  let cursor = 0;
  for (const citation of result.citations) {
    body.append(
      document.createTextNode(result.text.slice(cursor, citation.start)),
    );
    const link = element("a", result.text.slice(citation.start, citation.end));
    link.href = citation.url;
    link.title = citation.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    body.append(link);
    cursor = citation.end;
  }
  body.append(document.createTextNode(result.text.slice(cursor)));
  return body;
}

export function renderAnswers(config, results) {
  const open = new Set(
    [...$("answers").querySelectorAll("details[open]")].map(
      (node) => node.dataset.id,
    ),
  );
  const nodes = [...results]
    .sort(
      (a, b) =>
        a.questionIndex - b.questionIndex ||
        a.requestedProvider.localeCompare(b.requestedProvider),
    )
    .map((r) => {
      const row = element("details", undefined, "answer-row");
      row.dataset.id = r.id;
      row.open = open.has(r.id);
      const summary = element("summary");
      const prompted = hasMention(
        config.questions[r.questionIndex],
        [config.brand, ...config.aliases],
        true,
      );
      let status =
        r.status === "ok"
          ? r.mentioned
            ? "Mentioned"
            : "Not mentioned"
          : "Not measured";
      if (r.fallback) status += " · fallback";
      if (prompted) status += " · prompted";
      summary.append(
        element("span", config.questions[r.questionIndex], "answer-question"),
        element(
          "span",
          `${LABELS[r.requestedProvider]} · ${status}`,
          "answer-meta",
        ),
      );
      row.append(summary);
      if (r.status === "ok") {
        row.append(answerBody(r));
        row.append(
          element(
            "p",
            `Answered by ${LABELS[r.actualProvider]} · ${r.model ?? "Model not returned"} · ${(r.elapsedMs / 1000).toFixed(1)}s · ${r.citations.length} citation markers checked` +
              (r.fallback
                ? ` · Original failure: ${ERRORS[r.primaryError] ?? "Request failed"}. Excluded from comparison.`
                : "") +
              (prompted
                ? " · Brand appears in the question. Excluded from comparison."
                : ""),
            "answer-info",
          ),
        );
      } else
        row.append(
          element(
            "p",
            `${ERRORS[r.error] ?? "Not measured"}. No visibility score assigned.`,
            "answer-info",
          ),
        );
      return row;
    });
  $("answers").replaceChildren(...nodes);
  $("answer-total").textContent = `${results.length} answers`;
}
