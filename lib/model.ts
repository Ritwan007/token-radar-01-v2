// Token Launch Radar — model library (radar-3).
//
// Everything the board claims is computed from the sealed snapshot and
// nothing else: no name is special-cased, no figure is typed in by hand.
// The category multiple is calibrated on the snapshot's own live tokens —
// the median market-cap-to-TVL ratio of the protocols in that category
// whose token already trades, shrunk toward the global median so a small
// category cannot shout — then growth, maturity and chain breadth adjust
// it per protocol. The dashboard recomputes the same arithmetic in the
// page and shows the calibration table, so a reader can check every rank.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface CalibRow {
  category: string;
  live_count: number;
  median_ratio: number;
  p25_ratio: number;
  p75_ratio: number;
  multiple: number;
  low_multiple: number;
  high_multiple: number;
  reliability: string;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

const SHRINK_K = 5;
const MULT_FLOOR = 0.05;
const MULT_CAP = 1.0;

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Shrink a category statistic toward the global one; small samples move least. */
function shrink(n: number, value: number, globalValue: number): number {
  return (n * value + SHRINK_K * globalValue) / (n + SHRINK_K);
}

/**
 * Calibrate category multiples on the snapshot's live-token protocols.
 * Returns the global median and one row per category that has live tokens,
 * with the ratio spread (p25/p75) the detail view turns into a value band.
 */
export function calibrate(snapshot: Snapshot): { globalMedian: number; table: CalibRow[] } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  all.sort((a, b) => a - b);
  const globalMedian = median(all);
  const globalP25 = quantile(all, 0.25);
  const globalP75 = quantile(all, 0.75);
  const table: CalibRow[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(category)!.slice().sort((a, b) => a - b);
    const n = ratios.length;
    const med = median(ratios);
    const p25 = quantile(ratios, 0.25);
    const p75 = quantile(ratios, 0.75);
    const usable = n >= 3;
    table.push({
      category,
      live_count: n,
      median_ratio: round4(med),
      p25_ratio: round4(p25),
      p75_ratio: round4(p75),
      multiple: usable ? round4(clamp(shrink(n, med, globalMedian), MULT_FLOOR, MULT_CAP)) : round4(clamp(globalMedian, MULT_FLOOR, MULT_CAP)),
      low_multiple: usable ? round4(clamp(shrink(n, p25, globalP25), 0.02, MULT_CAP)) : round4(clamp(globalP25, 0.02, MULT_CAP)),
      high_multiple: usable ? round4(clamp(shrink(n, p75, globalP75), MULT_FLOOR, 2.0)) : round4(clamp(globalP75, MULT_FLOOR, 2.0)),
      reliability: n >= 8 ? 'firm' : usable ? 'fair' : 'thin',
    });
  }
  return { globalMedian, table };
}

/** The multiple a category prices at; categories with too few live tokens use the global median. */
export function multipleFor(calib: CalibRow[], globalMedian: number, category: string | null): number {
  if (category !== null) {
    const row = calib.find((r) => r.category === category);
    if (row !== undefined) return row.multiple;
  }
  return clamp(globalMedian, MULT_FLOOR, MULT_CAP);
}

export interface Factors {
  growth: number;
  growthMult: number;
  ageDays: number;
  maturity: number;
  breadth: number;
}

/** The per-protocol adjustments: 7-day growth, age with no token, chain breadth. */
export function factorsOf(p: Protocol, asOf: string): Factors {
  const growth = clamp(p.change_7d ?? 0, -50, 100);
  const growthMult = 1 + (growth / 100) * 0.5;
  const listed = p.listed_at === null ? Number.NaN : Date.parse(p.listed_at);
  const ageDays = Number.isNaN(listed) ? 365 : Math.max(0, Math.round((Date.parse(asOf) - listed) / 86_400_000));
  const maturity = 0.6 + (Math.min(ageDays, 1095) / 1095) * 0.4;
  const breadth = 1 + 0.01 * Math.min(p.chains.length, 8);
  return { growth, growthMult, ageDays, maturity, breadth };
}

/** The board's claim: what this protocol's token would be worth if its record stayed as it is. */
export function impliedOf(p: Protocol, multiple: number, f: Factors): number {
  return Math.max(1, Math.round(p.tvl_usd * multiple * f.growthMult * f.maturity * f.breadth));
}

/** Records no token in the snapshot (all three token fields empty). */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Rankable = a pre-token protocol that is not itself a wrapped, staked or
 * bridged product of a token that already trades, and not a versioned or
 * exchange-fronted duplicate — the watchlist's own rule, without its floor.
 */
export function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(V2|v2|2\.0|V3|v3)$/.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

function capitalTier(tvl: number): number {
  if (tvl >= 500_000_000) return 250;
  if (tvl >= 150_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

function weeklyActionFor(category: string | null): string {
  switch (category) {
    case 'Lending': return 'supply the deposit, borrow a small amount against it and repay inside the week';
    case 'Dexs': return 'swap a small amount in both directions and hold a small LP position';
    case 'Yield': return 'deposit into the vault and compound or claim the week\u2019s yield';
    case 'Yield Aggregator': return 'deposit into the aggregator vault and harvest or restake the week\u2019s yield';
    case 'CDP': return 'mint a small amount of the stablecoin against collateral and repay part of it';
    case 'RWA': return 'deposit into the tokenized-asset vault and hold the position';
    case 'Risk Curators': return 'deposit into one curated vault and rebalance if the curator moves';
    case 'Onchain Capital Allocator': return 'deposit into one allocator vault and follow its weekly rebalance';
    case 'Collateral Markets': return 'supply collateral and open one small, well-collateralized position';
    case 'Prediction Market': return 'take one small position on a liquid market and let it settle';
    case 'Payments': return 'route one small payment through it and keep the channel open';
    case 'Basis Trading': return 'hold the basis position and check the funding spread';
    case 'Indexes': return 'buy a small amount of the index basket and hold it';
    case 'Privacy': return 'make one private transfer of a small amount';
    default: return 'make one small deposit or trade so the week counts as active use';
  }
}

function holdDays(ageDays: number): number {
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** Six concrete steps per protocol, each with its cost and its time. */
export function farmSteps(p: Protocol, f: Factors): string[] {
  const capital = capitalTier(p.tvl_usd);
  const chain = p.chains[0] ?? 'its main chain';
  const weekly = weeklyActionFor(p.category);
  const hold = holdDays(f.ageDays);
  return [
    `Set up a fresh wallet for ${p.name} and write the seed phrase down offline; never farm from a wallet that holds savings. Cost: $0 \u00B7 Time: 15 minutes.`,
    `Move ${money(capital)} to ${chain} and make a first deposit with ${p.name}; a small, real position is what launch snapshots count. Cost: ${money(capital)} capital \u00B7 Time: 1 day to land and confirm.`,
    `Every week, ${weekly} on ${chain}; steady weeks beat one large deposit for most points programs. Cost: gas only, about $2 a week \u00B7 Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days across at least two monthly snapshots; closing early is the most common way a farm earns nothing. Cost: $0 \u00B7 Time: ${hold} days.`,
    `Claim only from the link ${p.name} itself publishes, after checking the contract address against its DefiLlama page; never pay anyone to claim for you. Cost: $0 \u00B7 Time: 30 minutes, when announced.`,
    `Keep a dated farm log (wallet, amounts, tx hashes) and exit in reverse order once the token trades, keeping a little gas on ${chain}. Cost: gas only \u00B7 Time: 1 hour.`,
  ];
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  stats: { protocols: number; watchlist: number; rows: number; early: number; live: number };
  calibration: CalibRow[];
  global_median: number;
  rows: unknown[];
  live: unknown[];
  chains: { name: string; rows: number }[];
}

/** Score every rankable protocol, rank them, and prepare the dashboard's dataset. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { globalMedian, table } = calibrate(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const f = factorsOf(p, snapshot.as_of);
      const multiple = multipleFor(table, globalMedian, p.category);
      return { p, f, multiple, implied: impliedOf(p, multiple, f) };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    tvl_usd: s.p.tvl_usd,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.f),
  }));

  const chainCounts = new Map<string, number>();
  for (const s of scored) for (const c of s.p.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);

  const rows = scored.map((s, i) => {
    const calib = table.find((r) => r.category === s.p.category);
    const lo = calib === undefined ? Math.max(1, Math.round(s.p.tvl_usd * clamp(globalMedian, 0.02, 1) * s.f.growthMult * s.f.maturity * s.f.breadth)) : Math.max(1, Math.round(s.p.tvl_usd * calib.low_multiple * s.f.growthMult * s.f.maturity * s.f.breadth));
    const hi = calib === undefined ? Math.max(1, Math.round(s.p.tvl_usd * clamp(globalMedian, MULT_FLOOR, 2) * s.f.growthMult * s.f.maturity * s.f.breadth)) : Math.max(1, Math.round(s.p.tvl_usd * calib.high_multiple * s.f.growthMult * s.f.maturity * s.f.breadth));
    return {
      slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
      tvl: s.p.tvl_usd, change7d: s.p.change_7d, ageDays: s.f.ageDays,
      rank: i + 1, implied: s.implied, lo, hi, multiple: s.multiple,
      growthMult: round4(s.f.growthMult), maturity: round4(s.f.maturity), breadth: round4(s.f.breadth),
      watchlist: watch.has(s.p.slug), steps: board[i]!.farm_steps,
    };
  });

  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl: p.tvl_usd,
      mcap: p.mcap_usd, ratio: p.tvl_usd > 0 ? round4((p.mcap_usd ?? 0) / p.tvl_usd) : 0, change7d: p.change_7d,
    }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    stats: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
      early: board.filter((r) => !watch.has(r.slug)).length,
      live: live.length,
    },
    calibration: table,
    global_median: round4(globalMedian),
    rows,
    live,
    chains: [...chainCounts.entries()].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows || (a.name < b.name ? -1 : 1)),
  };
  return { board, radar };
}

/** The dashboard's data file: the same figures the board was ranked from. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own checks, run before anything is written: refuse early, in the program. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const watch = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `rank ${row.rank} out of place at row ${i}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `${row.slug}: implied value out of range`;
    if (row.implied_value_usd > prev) return `${row.slug}: implied value rises with rank`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug}: ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug}: a farm step is ${len} characters`;
    }
  }
  if (allEqual) return 'every implied value is the same: that ranks nothing';
  for (const slug of watch) if (!seen.has(slug)) return `watchlist slug ${slug} is not on the board`;
  return null;
}
