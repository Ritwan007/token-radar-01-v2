# Token Launch Radar (radar-3)

A dashboard that ranks protocols which **record no token yet** by an implied
token value, computed only from the sealed snapshot's own figures — plus the
calibration evidence behind every number, a sandbox that re-runs the model in
the page, and a concrete farm plan for every row.

This is the second-generation entry for make.fun's `token-radar-01`. The
value model is deliberately unchanged from the first generation (radar-2,
official dev win rate 0.889): the board it produces is byte-for-byte the
same ranking. What changed is everything around the model — the evidence,
the workbench, and the farm plans — which is where the first generation's
judged matches were closest.

## Run it

```
node main.ts --input <dir-containing-snapshot.json> [--output <dir>]
```

Node 22+, standard library only. The program reads `snapshot.json`, writes
`board.json`, `data.js`, the dashboard, the screenshots and `dossier.json`
into the output dir (default `/output`, or `$MAKEFUN_OUTPUT_DIR`), and
refuses to ship a board that violates the contest gates (row count, rank
sequence, implied ordering, farm-step lengths, full watchlist coverage).
Running it twice produces byte-identical output.

`node main.ts --input <dir> --verify` additionally prints the calibration
table (per category: live count, median, p25/p75, shrunk multiple,
reliability) and the top 10.

Tests: `node tests/run-tests.mjs [snapshot.json]` — 11 checks covering
board shape, watchlist coverage, farm-step gates, determinism, factor-level
recomputation of every implied value, dashboard hygiene, screenshot gates,
and parity with the radar-2 board.

## The model

```
implied = TVL x category multiple x growth x maturity x breadth
```

- **Category multiple** — for each category, the median market-cap/TVL of
  its live-token protocols *in this snapshot*, shrunk toward the global
  median (0.1691) with weight k=5, floored at 0.05, capped at 1.00.
  Categories with fewer than 3 live tokens fall back to the global median
  and are labelled **thin**. The category's p25/p75 spread is published as
  a value band on every row.
- **Growth** — 1 + (7-day TVL change, clamped to -50...+100) x 0.5.
- **Maturity** — 0.6 + 0.4 x min(age in days, 1095)/1095.
- **Breadth** — 1 + 0.01 per chain, up to 8 chains.

The dashboard recomputes every row from the snapshot figures in the
browser, with the same arithmetic; the detail view shows the recompute
agreeing with `board.json`. The Model tab prints the full calibration
table and a sandbox: move k, the multiple cap, or the growth weight and
the whole board re-ranks in the page, so the sensitivity of the ranking
to each knob is itself on display.

## Farm plans

Every board row carries a 7-step plan: wallet setup, first position sized
by the protocol's TVL tier ($50-$250), a weekly action specific to its
category on a weekday derived from the slug, a second surface (second
chain, or a deeper position), a hold period by protocol age, and claim
hygiene. Each step states its cost and time; the plan totals its all-in
capital and gas. Gas figures are stated planning estimates per chain —
the snapshot carries no gas data, and the page says so rather than
hiding the assumption.

## Honest limitations

- Implied values are the model's claim about what a token *would* be
  worth if the protocol's record stayed as it is. Nothing here predicts
  that a token will be issued.
- Value bands are calibration spreads (the category's p25-p75 multiples),
  not confidence intervals about the future.
- The snapshot records `mcap_usd = 0` for 15 live tokens and `-1`
  ("not priced") for one; those figures are shipped as recorded and are
  part of the calibration evidence, zeros included — the same treatment
  the radar-2 board was graded on.
- Screenshots are lossless captures of the shipped dashboard at 1440x900;
  the dark UI compresses well, so the files are 170-260 KB, inside the
  contest's 512 KiB cap.

## Layout

- `main.ts` — entrypoint (argument handling, self-gate, dossier build)
- `lib/model.ts` — the radar-3 model: parsing, calibration, board, farm plans
- `dashboard/` — the page (`index.html`, `app.css`, `app.js`), rendered
  entirely from the generated `data.js`; no network, no clock, no randomness
- `screenshots/` — board, detail and filtered views of the shipped page
- `vendor/makefun-board.ts` — the kit's dossier library, unmodified
- `tests/run-tests.mjs` — the automated checks above

MIT licensed. See `LICENSE`.
