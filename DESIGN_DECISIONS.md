# Design decisions

## Keep the local app small

Node's HTTP server, fetch, abort signals and test runner cover the requirements. Browser modules render the page and SVG chart without a framework or chart library. There are no runtime package dependencies, build artifacts or external fonts to install. This keeps the example easy to inspect and run, at the cost of implementing form and stream state directly.

## Separate evidence from measurement

Providers are probabilistic and their schemas differ. Completion and citation checks happen before an answer is scored. A conservative rejection can lower coverage, but cannot silently turn missing evidence into a negative mention. The UI presents both rate and coverage because neither is useful alone.

## Do not let recovery rewrite a comparison

A fallback can recover an answer for a person to read, but it cannot stand in for the provider that failed. The chart and source ranking include primary results only. The report keeps both provider identities and the original failure so the recovery is reviewable.

## Generate questions without spending API budget

The initial question set uses generic templates. The user reviews and edits the actual prompts before running. This is deterministic and keeps the budget attributable to the measured answers. Templates are convenience scaffolding, not a claim about customer search demand.

## Validate references without crawling them

Fetching every returned link would add latency, robots/access complications and an arbitrary-URL network surface. This prototype checks provider citations, URL structure and citation spans or IDs. It exposes direct links so a person can inspect the evidence. It does not claim to validate factual entailment.

## Keep storage explicit

Neither credentials nor results are saved automatically. A user can download a report after inspecting it. This makes the retention choice visible, while accepting that a reload loses in-progress data and credentials must be re-entered for the next run.
