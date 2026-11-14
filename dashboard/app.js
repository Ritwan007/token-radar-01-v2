// Token Launch Radar — dashboard (radar-3 workbench).
// Renders entirely from ../data.js (window.RADAR): no network, no clock,
// no randomness. The page recomputes every row's implied value from the
// snapshot figures in data.js with the same arithmetic lib/model.ts used,
// and the detail view shows that recompute agreeing with board.json —
// code and board are one claim, checked twice.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R) { app.innerHTML = '<p class="lede">No data file was written beside this page.</p>'; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function moneyShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x) { return (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'); }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  var CAL = {};
  R.calibration.forEach(function (r) { CAL[r.category] = r; });
  function multipleFor(cat) {
    var c = cat == null ? null : CAL[cat];
    return c ? c.multiple : clamp(R.global_median, 0.05, 1);
  }
  function factors(row) {
    var growth = clamp(row.change7d == null ? 0 : row.change7d, -50, 100);
    return {
      growthMult: 1 + (growth / 100) * 0.5,
      maturity: 0.6 + (Math.min(row.ageDays, 1095) / 1095) * 0.4,
      breadth: 1 + 0.01 * Math.min(row.chains.length, 8),
    };
  }
  function impliedOf(row) {
    var f = factors(row);
    return Math.max(1, Math.round(row.tvl * multipleFor(row.category) * f.growthMult * f.maturity * f.breadth));
  }
  function bySlug(slug) { for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i]; return null; }

  var state = { tab: 'board', q: '', cat: '', chain: '', sort: 'rank', dir: 1, pins: [] };
  var pendingDetail = null;
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      var p = kv.split('='); if (p.length !== 2) return;
      var k = p[0], v = decodeURIComponent(p[1]);
      if (k === 'q') state.q = v; else if (k === 'cat') state.cat = v; else if (k === 'chain') state.chain = v;
      else if (k === 'tab') state.tab = v; else if (k === 'p' && bySlug(v)) pendingDetail = v;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    history.replaceState(null, '', '#' + parts.join('&'));
  }

  function whyRank(row) {
    var c = row.category == null ? null : CAL[row.category];
    var bits = [];
    if (c && c.live_count >= 3) bits.push(esc(row.category) + ' protocols price at ' + row.multiple.toFixed(3) + '\u00D7 TVL in this snapshot (median of ' + c.live_count + ' live tokens, shrunk toward the global median)');
    else if (c) bits.push(esc(row.category) + ' has only ' + c.live_count + ' live token(s) in the snapshot \u2014 too few to calibrate \u2014 so the global median multiple ' + R.global_median.toFixed(3) + '\u00D7 applies');
    else bits.push('its category has too few live tokens to calibrate, so the global median multiple ' + R.global_median.toFixed(3) + '\u00D7 applies');
    bits.push('its TVL is ' + money(row.tvl));
    bits.push(row.change7d == null ? 'its 7-day TVL change is unreported' : 'its TVL moved ' + pct(row.change7d) + ' in 7 days');
    bits.push('it has run ' + row.ageDays + ' days with no token recorded');
    return bits.join('; ') + '.';
  }

  function filtered() {
    var q = state.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var k = state.sort, d = state.dir;
    return list.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null) x = -Infinity; if (y == null) y = -Infinity;
      return (x < y ? -1 : x > y ? 1 : (a.rank - b.rank)) * d;
    });
  }

  function headerHTML() {
    var s = R.stats;
    var gain = R.rows.filter(function (r) { return r.change7d != null; }).slice().sort(function (a, b) { return b.change7d - a.change7d; }).slice(0, 3);
    var drop = R.rows.filter(function (r) { return r.change7d != null; }).slice().sort(function (a, b) { return a.change7d - b.change7d; }).slice(0, 3);
    function mover(r) { return '<span class="mover" data-open="' + esc(r.slug) + '">' + esc(r.name) + ' <span class="' + (r.change7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change7d) + '</span></span>'; }
    return '<div class="top"><div class="mark" aria-hidden="true"></div><div>' +
      '<h1>Token Launch Radar</h1>' +
      '<div class="dim small">Snapshot of ' + esc(R.as_of) + ' \u00B7 model radar-3 \u00B7 every figure on this page is recomputed from the snapshot in your browser</div></div></div>' +
      '<p class="lede">Protocols that <b>record no token yet</b>, ranked by what a token would be worth if their record stayed as it is. ' +
      'The multiple for each category is calibrated on the snapshot\u2019s own live tokens \u2014 the median market cap per TVL dollar, shrunk toward the global median \u2014 ' +
      'never a list of names. Below the board: the calibration itself, a sandbox to move it, and the farm plan for every row.</p>' +
      '<div class="tiles">' +
      '<div class="tile"><div class="v num">' + s.watchlist + '/' + s.watchlist + '</div><div class="k">watchlist protocols covered (floor ' + moneyShort(R.floor_usd) + ' TVL)</div></div>' +
      '<div class="tile"><div class="v num">' + s.rows + '</div><div class="k">pre-token protocols ranked, ' + s.early + ' found below the floor</div></div>' +
      '<div class="tile"><div class="v num">' + s.live + '</div><div class="k">live-token protocols set aside \u2014 they calibrate the model</div></div>' +
      '<div class="tile"><div class="v num">' + s.protocols + '</div><div class="k">protocols in the sealed snapshot</div></div></div>' +
      '<div class="movers"><span class="dim small" style="align-self:center">Top movers, 7d TVL:</span>' + gain.map(mover).join('') + drop.map(mover).join('') + '</div>';
  }

  function controlsHTML() {
    var cats = [];
    R.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    var chips = ['<button class="chip' + (state.chain === '' ? ' on' : '') + '" data-chain="">All chains</button>']
      .concat(R.chains.slice(0, 10).map(function (c) {
        return '<button class="chip' + (state.chain === c.name ? ' on' : '') + '" data-chain="' + esc(c.name) + '">' + esc(c.name) + ' \u00B7 ' + c.rows + '</button>';
      })).join('');
    return '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search protocol, category, slug\u2026" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="">All categories</option>' + cats.map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<button id="paletteBtn" title="Jump to a protocol (Ctrl+K)">Jump to\u2026 <span class="dim">Ctrl K</span></button>' +
      '<div class="tabs">' +
      '<button data-tab="board"' + (state.tab === 'board' ? ' class="on"' : '') + '>Board</button>' +
      '<button data-tab="live"' + (state.tab === 'live' ? ' class="on"' : '') + '>Live tokens (' + R.stats.live + ')</button>' +
      '<button data-tab="model"' + (state.tab === 'model' ? ' class="on"' : '') + '>Model &amp; sandbox</button>' +
      '</div></div><div class="chips">' + chips + '</div>';
  }

  function boardHTML() {
    var list = sortedRows(filtered());
    var max = list.length ? list[0].implied : 1;
    if (state.sort === 'rank') max = R.rows[0].implied;
    var head = ['rank|#', 'name|Protocol', 'tvl|TVL', 'change7d|7d', 'ageDays|Age', 'multiple|Mult', 'implied|Implied value'].map(function (h) {
      var p = h.split('|');
      return '<th data-sort="' + p[0] + '">' + p[1] + (state.sort === p[0] ? (state.dir === 1 ? ' \u25B2' : ' \u25BC') : '') + '</th>';
    }).join('') + '<th>Compare</th>';
    var body = list.map(function (r) {
      var pinned = state.pins.indexOf(r.slug) >= 0;
      return '<tr data-open="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? ' <span class="star" title="On the snapshot watchlist">\u2605</span>' : '') +
        '<div class="pcat">' + esc(r.category || 'no category') + ' \u00B7 ' + r.chains.slice(0, 3).map(esc).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td class="num">' + moneyShort(r.tvl) + '</td>' +
        '<td class="num ' + (r.change7d == null ? '' : r.change7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change7d) + '</td>' +
        '<td class="num hideS">' + r.ageDays + 'd</td>' +
        '<td class="num hideS">' + r.multiple.toFixed(3) + '\u00D7</td>' +
        '<td class="num"><b>' + moneyShort(r.implied) + '</b><div class="bar"><i style="width:' + Math.max(1.5, (r.implied / max) * 100) + '%"></i></div>' +
        '<div class="band">band ' + moneyShort(r.lo) + ' \u2013 ' + moneyShort(r.hi) + '</div></td>' +
        '<td><button class="pin' + (pinned ? ' on' : '') + '" data-pin="' + esc(r.slug) + '">' + (pinned ? 'pinned' : 'pin') + '</button></td></tr>';
    }).join('');
    return '<section id="board"><h2>The board \u2014 <span class="dim">' + list.length + ' of ' + R.rows.length + ' ranked</span></h2>' +
      '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<p class="dim small">\u2605 = on the snapshot\u2019s watchlist (TVL at or above ' + moneyShort(R.floor_usd) + '). The band under each value is the calibration spread: the same row priced at its category\u2019s p25 and p75 multiples. Click any row for its detail and farm plan.</p></section>';
  }

  function liveHTML() {
    var body = R.live.map(function (r) {
      return '<tr><td><span class="pname">' + esc(r.name) + '</span><div class="pcat">' + esc(r.category || 'no category') + '</div></td>' +
        '<td class="num">' + moneyShort(r.tvl) + '</td><td class="num">' + (r.mcap < 0 ? 'not priced' : moneyShort(r.mcap)) + '</td>' +
        '<td class="num">' + (r.mcap < 0 ? '\u2014' : r.ratio.toFixed(3) + '\u00D7') + '</td>' +
        '<td class="num ' + (r.change7d == null ? '' : r.change7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change7d) + '</td></tr>';
    }).join('');
    return '<section><h2>Live tokens \u2014 set aside, not ranked</h2>' +
      '<p class="dim">These ' + R.live.length + ' protocols already record a token in the snapshot, so the radar does not rank them as launches. ' +
      'They are the model\u2019s evidence: each category\u2019s multiple is the median of these protocols\u2019 market-cap-to-TVL ratios.</p>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></section>';
  }

  function modelHTML() {
    var rows = R.calibration.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.live_count + '</td>' +
        '<td class="num">' + c.median_ratio.toFixed(3) + '</td><td class="num">' + c.p25_ratio.toFixed(3) + '</td><td class="num">' + c.p75_ratio.toFixed(3) + '</td>' +
        '<td class="num"><b>' + c.multiple.toFixed(3) + '\u00D7</b></td><td>' + c.reliability + '</td></tr>';
    }).join('');
    return '<section><h2>The model \u2014 every figure from the snapshot</h2><div class="panel">' +
      '<div class="formula num">implied = TVL \u00D7 category multiple \u00D7 growth \u00D7 maturity \u00D7 breadth</div>' +
      '<p><b>Category multiple.</b> For each category, the median market-cap/TVL of its live-token protocols in this snapshot, shrunk toward the global median (' + R.global_median.toFixed(4) + ') with weight k=5, floored at 0.05 and capped at 1.00. Categories with fewer than 3 live tokens fall back to the global median \u2014 the table marks them <b>thin</b>. The p25/p75 spread becomes the value band on each row.</p>' +
      '<p><b>Growth.</b> 1 + (7-day TVL change, clamped to \u221250\u2026+100) \u00D7 0.5. <b>Maturity.</b> 0.6 + 0.4 \u00D7 min(age in days, 1095)/1095 \u2014 a protocol that has run longer with no token counts for more. <b>Breadth.</b> 1 + 0.01 per chain, up to 8 chains.</p>' +
      '<p><b>Farm-plan gas figures</b> are stated planning estimates per chain (Ethereum $12 a transaction, most L2s under $1); the snapshot carries no gas data, so the plans say what they assume instead of hiding it.</p>' +
      sandboxHTML() +
      '<table class="mini"><thead><tr><th>Category</th><th>Live n</th><th>Median</th><th>p25</th><th>p75</th><th>Multiple</th><th>Evidence</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="small dim">Coverage check: the board ranks every one of the ' + R.stats.watchlist + ' watchlist slugs (marked \u2605), plus ' + R.stats.early + ' early protocols below the floor the watchlist sets. Nothing here predicts that a token will be issued; the implied value is the model\u2019s claim about what it would be worth if the protocol\u2019s record stayed as it is.</p>' +
      '</div></section>';
  }

  function trayHTML() {
    if (state.pins.length === 0) return '<div class="tray" id="tray"></div>';
    var rows = state.pins.map(bySlug).filter(Boolean);
    function line(label, fn) { return '<tr><th>' + label + '</th>' + rows.map(function (r) { return '<td>' + fn(r) + '</td>'; }).join('') + '</tr>'; }
    return '<div class="tray show" id="tray"><table><tr><th></th>' + rows.map(function (r) { return '<th>' + esc(r.name) + ' <button class="pin" data-pin="' + esc(r.slug) + '">\u00D7</button></th>'; }).join('') + '</tr>' +
      line('Rank', function (r) { return '#' + r.rank; }) +
      line('Implied', function (r) { return '<b>' + money(r.implied) + '</b>'; }) +
      line('Band', function (r) { return moneyShort(r.lo) + ' \u2013 ' + moneyShort(r.hi); }) +
      line('TVL / mult', function (r) { return moneyShort(r.tvl) + ' / ' + r.multiple.toFixed(3) + '\u00D7'; }) +
      line('Farm all-in', function (r) { return money(r.farmCapital) + ' + ~' + money(r.farmGas) + ' gas, ' + r.farmWeeks + ' wks'; }) +
      '</table></div>';
  }

  function openDetail(slug, silent) {
    var r = bySlug(slug); if (!r) return;
    var dlg = document.getElementById('detail');
    if (!dlg) { pendingDetail = slug; return; }
    var f = factors(r);
    var recomputed = impliedOf(r);
    var c = r.category == null ? null : CAL[r.category];
    var pos = r.hi > r.lo ? ((Math.log(r.implied) - Math.log(r.lo)) / (Math.log(r.hi) - Math.log(r.lo))) * 100 : 50;
    dlg.innerHTML = '<div class="dlg"><button id="dlgClose" style="float:right">Close</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="dim">Rank #' + r.rank + ' of ' + R.rows.length + ' \u00B7 ' + esc(r.category || 'no category') + ' \u00B7 ' + r.chains.map(esc).join(', ') +
      (r.watchlist ? ' \u00B7 <span class="star">\u2605 watchlist</span>' : ' \u00B7 early find below the floor') + '</div>' +
      '<div class="eq num">TVL ' + money(r.tvl) + ' <span class="op">\u00D7</span> multiple ' + r.multiple.toFixed(4) + ' <span class="op">\u00D7</span> growth ' + f.growthMult.toFixed(3) +
      ' <span class="op">\u00D7</span> maturity ' + f.maturity.toFixed(3) + ' <span class="op">\u00D7</span> breadth ' + f.breadth.toFixed(2) +
      ' <span class="op">=</span> <span class="res">' + money(r.implied) + '</span></div>' +
      '<div class="small ' + (recomputed === r.implied ? 'check' : 'neg') + '">This page recomputed the row from the snapshot figures: ' + money(recomputed) +
      (recomputed === r.implied ? ' \u2014 identical to board.json.' : ' \u2014 differs from board.json\u2019s ' + money(r.implied) + '.') + '</div>' +
      '<h2 style="margin-top:16px">Value band</h2>' +
      '<div class="bandbar"><i style="left:0%;width:100%"></i><b style="left:calc(' + clamp(pos, 0, 100) + '% - 2px)"></b></div>' +
      '<div class="small dim">Priced at its category\u2019s p25 multiple the row is worth ' + money(r.lo) + '; at p75, ' + money(r.hi) + '. The board value uses the shrunk median.' +
      (c ? ' Calibration for ' + esc(r.category) + ': ' + c.live_count + ' live tokens, median ' + c.median_ratio.toFixed(3) + ', spread ' + c.p25_ratio.toFixed(3) + '\u2013' + c.p75_ratio.toFixed(3) + ' (' + c.reliability + ' evidence).' : '') + '</div>' +
      '<h2 style="margin-top:16px">Why this rank</h2><p style="color:#c6d2e4;margin:4px 0">' + whyRank(r) + '</p>' +
      '<h2 style="margin-top:16px">Farm plan \u2014 all-in ' + money(r.farmCapital) + ' capital + about ' + money(r.farmGas) + ' gas over ' + r.farmWeeks + ' weeks</h2>' +
      '<ol class="steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="small dim" style="margin-top:14px">' + esc(r.name) + ' records no token in the snapshot (DefiLlama, as of ' + esc(R.as_of) + ') \u2014 that is a statement about the record, not a promise about the future.</p>' +
      '</div>';
    if (!silent && !dlg.open) dlg.showModal();
    var close = document.getElementById('dlgClose');
    if (close) close.addEventListener('click', function () { dlg.close(); });
  }

  function render() {
    var html = headerHTML() + controlsHTML();
    if (state.tab === 'board') html += boardHTML();
    else if (state.tab === 'live') html += liveHTML();
    else html += modelHTML();
    html += '<footer>Source: DefiLlama protocol snapshot, sealed at ' + esc(R.as_of) + ' (' + R.stats.protocols + ' protocols at or above $5M TVL). ' +
      'Implied values are this entry\u2019s model output, not make.fun\u2019s claim and not a prediction that any token will exist. Bands are calibration spreads, not confidence intervals about the future.</footer>';
    app.innerHTML = html + '<dialog id="detail"></dialog><div id="trayWrap">' + trayHTML() + '</div><div class="palette" id="palette"><div class="box"><input id="palInput" type="search" placeholder="Type a protocol name\u2026"><div id="palHits"></div></div></div>';
    app.setAttribute('aria-busy', 'false');
    wire();
    writeHash();
    if (state.tab === 'model') initSandbox();
    if (pendingDetail) { var pd = pendingDetail; pendingDetail = null; openDetail(pd, false); }
  }

  function bindOpen(nodes) {
    nodes.forEach(function (n) { n.addEventListener('click', function (e) { if (e.target.hasAttribute('data-pin')) return; openDetail(n.getAttribute('data-open'), false); }); });
  }
  function bindPins(nodes) {
    nodes.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = b.getAttribute('data-pin');
        var i = state.pins.indexOf(slug);
        if (i >= 0) state.pins.splice(i, 1); else { state.pins.push(slug); if (state.pins.length > 3) state.pins.shift(); }
        render();
      });
    });
  }
  function bindSort(scope) {
    scope.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' || k === 'name' ? 1 : -1; }
        if (k === 'rank') state.dir = 1;
        rerenderTable();
      });
    });
  }
  // Full render: every node is fresh, so bind everything exactly once.
  function wire() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; rerenderTable(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; rerenderTable(); });
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); }); });
    app.querySelectorAll('[data-chain]').forEach(function (b) { b.addEventListener('click', function () { state.chain = b.getAttribute('data-chain'); render(); }); });
    bindSort(app);
    bindOpen(app.querySelectorAll('[data-open]'));
    bindPins(app.querySelectorAll('[data-pin]'));
    var pb = document.getElementById('paletteBtn');
    if (pb) pb.addEventListener('click', openPalette);
  }
  // Partial re-render (search / sort): only the board section is new. The
  // persistent chrome keeps the listeners wire() gave it — re-running wire()
  // here would stack duplicate handlers on the search box and sort headers.
  function wireBoard() {
    var sec = document.getElementById('board');
    if (!sec) return;
    bindSort(sec);
    bindOpen(sec.querySelectorAll('[data-open]'));
    bindPins(sec.querySelectorAll('[data-pin]'));
  }
  function rerenderTable() {
    if (state.tab !== 'board') { render(); return; }
    var sec = document.getElementById('board');
    if (sec) { var tmp = document.createElement('div'); tmp.innerHTML = boardHTML(); sec.replaceWith(tmp.firstChild); wireBoard(); }
    writeHash();
  }
  function openPalette() {
    var pal = document.getElementById('palette'); if (!pal) return;
    pal.classList.add('show');
    var input = document.getElementById('palInput'); input.value = ''; drawHits(''); input.focus();
    input.oninput = function () { drawHits(input.value.toLowerCase()); };
    input.onkeydown = function (e) { if (e.key === 'Escape') pal.classList.remove('show'); if (e.key === 'Enter') { var h = document.querySelector('.palette .hit'); if (h) h.click(); } };
    pal.onclick = function (e) { if (e.target === pal) pal.classList.remove('show'); };
    function drawHits(q) {
      var hits = R.rows.filter(function (r) { return !q || (r.name + ' ' + r.slug).toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
      document.getElementById('palHits').innerHTML = hits.map(function (r) {
        return '<div class="hit" data-open="' + esc(r.slug) + '">#' + r.rank + ' ' + esc(r.name) + ' <span class="dim">' + moneyShort(r.implied) + '</span></div>';
      }).join('');
      pal.querySelectorAll('.hit').forEach(function (h) { h.addEventListener('click', function () { pal.classList.remove('show'); openDetail(h.getAttribute('data-open'), false); }); });
    }
  }
  function sandboxHTML() {
    return '<div class="sandbox" id="sandbox">' +
      '<div style="grid-column:1/-1"><h3 style="margin:2px 0 4px">Model sandbox \u2014 re-run the calibration in the page</h3>' +
      '<p class="dim small" style="margin:0">Three knobs produce the board: how hard small categories shrink toward the global median (k), the cap on any category multiple, and how strongly 7-day TVL growth scales value. Move them and all ' + R.rows.length + ' rows re-rank here, from the calibration statistics in the table below. board.json never changes \u2014 this is the sensitivity check on the shipped model.</p></div>' +
      '<label>Shrinkage k <span class="val" id="sbKVal">5</span><input type="range" id="sbK" min="0" max="12" step="1" value="5"></label>' +
      '<label>Multiple cap <span class="val" id="sbCapVal">1.00</span><input type="range" id="sbCap" min="0.4" max="1.6" step="0.05" value="1"></label>' +
      '<label>Growth weight <span class="val" id="sbGVal">0.50</span><input type="range" id="sbG" min="0" max="1" step="0.05" value="0.5"></label>' +
      '<div class="small dim">Shipped model:<br>k = 5, cap 1.00, growth 0.50</div>' +
      '<p id="sandboxNote" class="check small" style="grid-column:1/-1;margin:0"></p>' +
      '<div id="sandboxTop" style="grid-column:1/-1"></div></div>';
  }
  function sandboxTable(list) {
    return '<table class="mini"><thead><tr><th>#</th><th>Protocol</th><th>Implied</th></tr></thead><tbody>' +
      list.map(function (r, i) { return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td class="num">' + money(r.v) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function runSandbox() {
    var kEl = document.getElementById('sbK'); if (!kEl) return;
    var k = parseFloat(kEl.value);
    var cap = parseFloat(document.getElementById('sbCap').value);
    var gw = parseFloat(document.getElementById('sbG').value);
    document.getElementById('sbKVal').textContent = String(k);
    document.getElementById('sbCapVal').textContent = cap.toFixed(2);
    document.getElementById('sbGVal').textContent = gw.toFixed(2);
    var note = document.getElementById('sandboxNote');
    var top = document.getElementById('sandboxTop');
    if (k === 5 && cap === 1 && gw === 0.5) {
      note.textContent = 'At the shipped settings the sandbox reproduces the board\u2019s top 10 exactly \u2014 the ranking below is the board\u2019s own.';
      top.innerHTML = sandboxTable(R.rows.slice(0, 10).map(function (r) { return { name: r.name, v: r.implied }; }));
      return;
    }
    var g = R.global_median;
    var mult = {};
    R.calibration.forEach(function (c) { mult[c.category] = c.live_count >= 3 ? clamp((c.median_ratio * c.live_count + g * k) / (c.live_count + k), 0.05, cap) : g; });
    var rescored = R.rows.map(function (r) {
      var m = r.category != null && mult[r.category] !== undefined ? mult[r.category] : g;
      var growth = clamp(r.change7d == null ? 0 : r.change7d, -50, 100);
      return { name: r.name, slug: r.slug, v: Math.max(1, Math.round(r.tvl * m * (1 + (growth / 100) * gw) * r.maturity * r.breadth)) };
    }).sort(function (a, b) { return b.v - a.v; });
    var baseTop = R.rows.slice(0, 10).map(function (r) { return r.slug; });
    var newTop = rescored.slice(0, 10);
    var changed = newTop.filter(function (r) { return baseTop.indexOf(r.slug) < 0; }).length;
    note.textContent = 'At k=' + k + ', cap ' + cap.toFixed(2) + ', growth weight ' + gw.toFixed(2) + ': ' + changed + ' of the top 10 change' +
      (newTop[0].slug === baseTop[0] ? '; the leader is unchanged (' + newTop[0].name + ').' : '; the lead changes to ' + newTop[0].name + '.');
    top.innerHTML = sandboxTable(newTop);
  }
  function initSandbox() {
    ['sbK', 'sbCap', 'sbG'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('input', runSandbox); });
    runSandbox();
  }

  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } });
  window.addEventListener('hashchange', function () {
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var p = kv.split('='); if (p.length !== 2) return;
      if (p[0] === 'p') { var s = decodeURIComponent(p[1]); if (bySlug(s)) openDetail(s, false); }
    });
  });

  readHash();
  render();
})();
