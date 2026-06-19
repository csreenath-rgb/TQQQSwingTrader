(function () {
  "use strict";
  const E = window.Engine, D = window.DATA, META = D.meta;
  const $ = id => document.getElementById(id);
  const AINFO = META.anchors || {};
  const ALABEL = k => k.toUpperCase();
  const cssVar = n => (getComputedStyle(document.body).getPropertyValue(n) || "").trim() || "#64748b";
  function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    const b = $("themeToggle"); if (b) b.innerHTML = dark ? "&#9728; Light" : "&#127769; Dark";
    try { localStorage.setItem("lrs_theme", dark ? "dark" : "light"); } catch (e) {}
    if (lastRun) renderChart(currentChartType);
  }

  const PALETTE = ["#6366f1", "#0ea5e9", "#d97706", "#7c3aed", "#db2777", "#0d9488", "#65a30d"];
  const DEFAULTS = {
    initialCapital: 100000, startDate: D.dates[0], endDate: D.dates[D.dates.length - 1],
    enginePct: 70, anchorKey: "jepq", anchorYield: (AINFO.jepq ? AINFO.jepq.yield_ : 10),
    smaWindow: 50, volWindow: 20, volThresh: 60,
    rsiWindow: 14, rsiOverheat: 75, rsiOversold: 30,
    wTrend: 0.4, wVol: 0.3, wRsiHot: 0.3, wRsiCold: -0.3, vixThresh: 40,
    lookup: [{ h: 0, f: 0 }, { h: 0.3, f: 0.2143 }, { h: 0.4, f: 0.4 }, { h: 0.7, f: 0.7143 }, { h: 1, f: 1 }],
    vetoRsiOversold: true, safetySwitch: true, jepqRouteIncome: true,
    whipsaw: false, whipsawDetector: "both", adxWindow: 14, adxThresh: 20, erWindow: 10, erThresh: 0.30,
    rebalance: "weekly", executeTiming: "nextOpen", rebalanceBand: 5, signalLagDays: 1,
    accountType: "taxable", stRate: 35, ltRate: 15, incomeRate: 35,
    tradingCostBps: 5, extraMgmtFeePct: 0, riskFreePct: 4.3
  };
  const RANGES = {
    enginePct: [0, 100], anchorYield: [0, 20], smaWindow: [5, 250], volWindow: [5, 120], volThresh: [10, 150],
    rsiWindow: [2, 50], rsiOverheat: [50, 95], rsiOversold: [5, 50],
    wTrend: [0, 1], wVol: [0, 1], wRsiHot: [0, 1], wRsiCold: [-1, 0], vixThresh: [10, 90],
    adxWindow: [5, 50], adxThresh: [5, 50], erWindow: [3, 40], erThresh: [0, 1],
    rebalanceBand: [0, 50], stRate: [0, 60], ltRate: [0, 40], incomeRate: [0, 60],
    tradingCostBps: [0, 50], extraMgmtFeePct: [0, 3], riskFreePct: [0, 10], initialCapital: [1000, 1e8]
  };
  let params = structuredClone(DEFAULTS);
  let prevAnchor = params.anchorKey;
  let versions = [];
  let editingVersionId = null;
  let compare = { qqq: true, tqqq: true, ver: {} };
  let chart = null, currentChartType = "equity";
  let lastRun = null;
  let storageBlocked = false;

  const pct = (x, d = 2) => (x == null || isNaN(x)) ? "&mdash;" : (x * 100).toFixed(d) + "%";
  const pct1 = x => pct(x, 1);
  const num = (x, d = 2) => (x == null || isNaN(x)) ? "&mdash;" : x.toFixed(d);
  const money = x => (x == null || isNaN(x)) ? "&mdash;" : "$" + Math.round(x).toLocaleString("en-US");
  const moneyShort = x => {
    if (x == null || isNaN(x)) return "&mdash;";
    const a = Math.abs(x);
    if (a >= 1e6) return (x < 0 ? "-$" : "$") + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (x < 0 ? "-$" : "$") + (a / 1e3).toFixed(0) + "k";
    return (x < 0 ? "-$" : "$") + a.toFixed(0);
  };
  const ANCHOR_KEYS = ["jepq", "jepi", "qyld", "schd", "bil", "adx"];
  const ANCHOR_LABELS = { jepq: "JEPQ — JPMorgan Nasdaq income", jepi: "JEPI — JPMorgan S&P income",
    qyld: "QYLD — Nasdaq covered call", schd: "SCHD — dividend growth", bil: "BIL — 1-3mo T-bills (cash)", adx: "ADX — Adams Diversified Equity" };
  const DET_LABELS = { both: "ADX & ER (both, selective)", either: "ADX or ER (either)", adx: "ADX only", er: "Efficiency Ratio only" };
  const REBAL_LABELS = { weekly: "Weekly (Fri→Mon)", monthly: "Monthly", daily: "Daily", signal: "Signal-driven (daily eval, trade on drift)" };
  const TIMING_LABELS = { nextOpen: "Next day's open", sameClose: "Same day, ~15m before close" };
  const ACCT_LABELS = { taxable: "Taxable (brokerage)", taxAdvantaged: "Tax-advantaged (IRA/401k)" };

  const GROUPS = [
    { title: "Capital & backtest window", items: [
      { key: "initialCapital", label: "Starting capital", type: "number", step: 1000 },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" } ] },
    { title: "Allocation split", items: [
      { key: "enginePct", label: "Engine sleeve (TQQQ/SQQQ)", type: "slider", min: 0, max: 100, step: 5, suffix: "%" } ] },
    { title: "Anchor sleeve (the rest)", items: [
      { key: "anchorKey", label: "Anchor fund", type: "select", options: ANCHOR_KEYS, optionLabels: ANCHOR_LABELS },
      { key: "anchorYield", label: "Anchor distribution yield", hint: "annual; auto-set per fund", type: "number", step: 0.5, suffix: "%" } ] },
    { title: "Rebalancing", items: [
      { key: "rebalance", label: "Cadence", type: "select", options: ["weekly", "monthly", "daily", "signal"], optionLabels: REBAL_LABELS },
      { key: "executeTiming", label: "Execution timing", type: "select", options: ["nextOpen", "sameClose"], optionLabels: TIMING_LABELS },
      { key: "rebalanceBand", label: "Rebalance band", hint: "signal mode: min % change to trade", type: "number", step: 1, suffix: "%" } ] },
    { title: "Whipsaw filter (parks engine in TLT)", items: [
      { key: "whipsaw", label: "Enable whipsaw filter", type: "switch" },
      { key: "whipsawDetector", label: "Detector", type: "select", options: ["both", "either", "adx", "er"], optionLabels: DET_LABELS },
      { key: "adxWindow", label: "ADX period", type: "number", step: 1, suffix: "d" },
      { key: "adxThresh", label: "ADX choppy threshold", hint: "below = whipsaw", type: "number", step: 1 },
      { key: "erWindow", label: "Efficiency Ratio window", type: "number", step: 1, suffix: "d" },
      { key: "erThresh", label: "ER choppy threshold", hint: "below = whipsaw", type: "number", step: 0.05 } ] },
    { title: "Trend & volatility signals", items: [
      { key: "smaWindow", label: "Trend SMA window", hint: "TQQQ below it &rarr; +score", type: "number", step: 1, suffix: "d" },
      { key: "volWindow", label: "Volatility lookback", type: "number", step: 1, suffix: "d" },
      { key: "volThresh", label: "High-volatility threshold", hint: "annualized", type: "number", step: 1, suffix: "%" } ] },
    { title: "RSI signals", items: [
      { key: "rsiWindow", label: "RSI period", type: "number", step: 1, suffix: "d" },
      { key: "rsiOverheat", label: "Overbought level", hint: "above &rarr; +score", type: "number", step: 1 },
      { key: "rsiOversold", label: "Oversold level", hint: "below &rarr; &minus;score & veto", type: "number", step: 1 } ] },
    { title: "Hedge-score weights", items: [
      { key: "wTrend", label: "Downtrend weight", type: "number", step: 0.05 },
      { key: "wVol", label: "High-volatility weight", type: "number", step: 0.05 },
      { key: "wRsiHot", label: "Overbought weight", type: "number", step: 0.05 },
      { key: "wRsiCold", label: "Oversold weight", hint: "negative", type: "number", step: 0.05 } ] },
    { title: "Allocation lookup (score &rarr; SQQQ share of engine)", items: [
      { key: "lookup", type: "lookup" },
      { key: "vixThresh", label: "VIX safety threshold", hint: "above &rarr; hedge to TLT", type: "number", step: 1 } ] },
    { title: "Rules", items: [
      { key: "vetoRsiOversold", label: "Oversold veto (stay long)", type: "switch" },
      { key: "safetySwitch", label: "VIX safety switch (SQQQ&rarr;TLT)", type: "switch" },
      { key: "jepqRouteIncome", label: "Route anchor income into TQQQ", type: "switch" } ] },
    { title: "Taxes", items: [
      { key: "accountType", label: "Account type", type: "select", options: ["taxable", "taxAdvantaged"], optionLabels: ACCT_LABELS },
      { key: "stRate", label: "Short-term rate", hint: "ordinary income", type: "number", step: 1, suffix: "%" },
      { key: "ltRate", label: "Long-term rate", type: "number", step: 1, suffix: "%" },
      { key: "incomeRate", label: "Income/distribution rate", type: "number", step: 1, suffix: "%" } ] },
    { title: "Costs & assumptions", items: [
      { key: "tradingCostBps", label: "Trading cost per rebalance", hint: "bps on turnover", type: "number", step: 1 },
      { key: "extraMgmtFeePct", label: "Extra annual fee", hint: "fund ERs already in prices", type: "number", step: 0.05, suffix: "%" },
      { key: "riskFreePct", label: "Risk-free rate", hint: "for Sharpe/Sortino", type: "number", step: 0.1, suffix: "%" } ] }
  ];

  function buildControls() {
    const host = $("controlGroups"); host.innerHTML = "";
    GROUPS.forEach(g => {
      const wrap = document.createElement("div"); wrap.className = "group";
      wrap.innerHTML = `<div class="section-title" style="margin-bottom:6px">${g.title}</div>`;
      g.items.forEach(it => wrap.appendChild(buildControl(it)));
      host.appendChild(wrap);
    });
    syncControlsFromParams();
  }
  function buildControl(it) {
    const row = document.createElement("div");
    if (it.type === "lookup") { row.innerHTML = renderLookup(); return row; }
    row.className = "ctl";
    const lab = document.createElement("label");
    lab.innerHTML = it.label + (it.hint ? ` <span class="hint">(${it.hint})</span>` : "");
    row.appendChild(lab);
    let input;
    if (it.type === "switch") {
      const w = document.createElement("span"); w.className = "switch";
      input = document.createElement("input"); input.type = "checkbox"; input.id = "c_" + it.key;
      w.appendChild(input); row.appendChild(w); input.addEventListener("change", onControlChange);
    } else if (it.type === "select") {
      input = document.createElement("select"); input.id = "c_" + it.key;
      it.options.forEach(o => { const op = document.createElement("option"); op.value = o; op.textContent = it.optionLabels ? it.optionLabels[o] : o; input.appendChild(op); });
      row.appendChild(input); input.addEventListener("change", onControlChange);
    } else if (it.type === "slider") {
      const box = document.createElement("span"); box.style.cssText = "display:flex;align-items:center;gap:8px";
      input = document.createElement("input"); input.type = "range"; input.id = "c_" + it.key;
      input.min = it.min; input.max = it.max; input.step = it.step;
      const out = document.createElement("b"); out.id = "o_" + it.key; out.style.minWidth = "70px"; out.style.textAlign = "right";
      box.appendChild(input); box.appendChild(out); row.appendChild(box);
      input.addEventListener("input", () => sliderOut(it.key, input.value, it.suffix));
      input.addEventListener("change", onControlChange);
    } else {
      const box = document.createElement("span"); box.style.cssText = "display:flex;align-items:center;gap:5px";
      input = document.createElement("input"); input.type = it.type === "date" ? "date" : "number";
      input.id = "c_" + it.key; if (it.step) input.step = it.step;
      if (it.type === "date") { input.min = D.dates[0]; input.max = D.dates[D.dates.length - 1]; }
      box.appendChild(input);
      if (it.suffix) { const s = document.createElement("span"); s.className = "hint"; s.textContent = it.suffix; box.appendChild(s); }
      row.appendChild(box); input.addEventListener("change", onControlChange);
    }
    return row;
  }
  function renderLookup() {
    let rows = params.lookup.map((r, i) =>
      `<tr><td><input data-lk="${i}" data-f="h" value="${r.h}"></td><td><input data-lk="${i}" data-f="f" value="${(r.f * 100).toFixed(1)}">%</td></tr>`).join("");
    return `<table class="lookup-table"><thead><tr><th>Hedge score</th><th>SQQQ % of engine</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function sliderOut(key, val, suffix) {
    const o = $("o_" + key); if (o) o.innerHTML = val + (suffix || "") + (key === "enginePct" ? ` <span class="hint">/ ${100 - val}% anchor</span>` : "");
  }
  function syncControlsFromParams() {
    GROUPS.forEach(g => g.items.forEach(it => {
      if (it.type === "lookup") return;
      const el = $("c_" + it.key); if (!el) return;
      if (it.type === "switch") el.checked = !!params[it.key]; else el.value = params[it.key];
      if (it.type === "slider") sliderOut(it.key, el.value, it.suffix);
    }));
    document.querySelectorAll("[data-lk]").forEach(inp => {
      const i = +inp.dataset.lk, f = inp.dataset.f;
      inp.value = f === "h" ? params.lookup[i].h : (params.lookup[i].f * 100).toFixed(1);
    });
  }
  function readParams() {
    const p = structuredClone(params);
    GROUPS.forEach(g => g.items.forEach(it => {
      if (it.type === "lookup") return;
      const el = $("c_" + it.key); if (!el) return;
      if (it.type === "switch") p[it.key] = el.checked;
      else if (it.type === "select") p[it.key] = el.value;
      else if (it.type === "date") p[it.key] = el.value;
      else p[it.key] = +el.value;
    }));
    const lk = [];
    document.querySelectorAll("[data-lk]").forEach(inp => {
      const i = +inp.dataset.lk, f = inp.dataset.f; lk[i] = lk[i] || {};
      lk[i][f] = f === "h" ? +inp.value : (+inp.value) / 100;
    });
    if (lk.length) p.lookup = lk.filter(Boolean);
    return p;
  }
  function onControlChange() {
    params = readParams();
    if (params.anchorKey !== prevAnchor) {
      const y = AINFO[params.anchorKey] ? AINFO[params.anchorKey].yield_ : params.anchorYield;
      params.anchorYield = y; const el = $("c_anchorYield"); if (el) el.value = y; prevAnchor = params.anchorKey;
    }
    updateSummary(); persist(); run();
  }

  function stateForScore(h) {
    if (h <= 0.001) return ["Bull Run", "#16a34a"];
    if (h < 0.35) return ["Weakness", "#ca8a04"];
    if (h < 0.55) return ["Bear Entry", "#ea580c"];
    if (h < 0.85) return ["Full Crash", "#dc2626"];
    return ["Panic", "#7f1d1d"];
  }
  function updateSummary() {
    const p = params, anchor = 100 - p.enginePct, aLab = ALABEL(p.anchorKey);
    const _st = $("subTitle");
    if (_st) _st.innerHTML = p.enginePct + "% Engine (TQQQ/SQQQ) + " + anchor + "% " + aLab + " anchor · " + (p.safetySwitch ? "VIX safety &rarr; TLT · " : "") + (p.whipsaw ? "whipsaw &rarr; TLT · " : "") + (p.accountType === "taxable" ? "after-tax · " : "") + "vs QQQ &amp; TQQQ";
    const sweep = p.jepqRouteIncome ? `${aLab}'s ~${p.anchorYield}%/yr income is swept into TQQQ` : `${aLab}'s income stays in ${aLab}`;
    const veto = p.vetoRsiOversold ? `If RSI &lt; <b>${p.rsiOversold}</b> the hedge is <b>vetoed</b>.` : `Oversold veto <b>off</b>.`;
    const safety = p.safetySwitch ? `If <b>VIX</b> &gt; <b>${p.vixThresh}</b>, the SQQQ hedge goes to <b>TLT</b>.` : `VIX safety switch <b>off</b>.`;
    let whip = p.whipsaw ? `<b>Whipsaw filter ON</b> (${p.whipsawDetector}): in choppy markets the entire engine parks in <b>TLT</b>.` : `Whipsaw filter <b>off</b>.`;
    const cadence = p.rebalance === "signal"
      ? `Evaluated <b>daily</b>; trades only when the target allocation drifts more than <b>${p.rebalanceBand}%</b>`
      : `Rebalanced <b>${p.rebalance}</b>`;
    const timing = p.executeTiming === "sameClose" ? "executed same day (~15m before close)" : "executed at the next open";
    const taxLine = p.accountType === "taxable"
      ? `<b>Taxable account:</b> short-term gains taxed at <b>${p.stRate}%</b>, long-term at <b>${p.ltRate}%</b>, income at <b>${p.incomeRate}%</b>. All performance below is <b>after-tax</b>.`
      : `<b>Tax-advantaged account</b> (IRA/401k) — no taxes modeled.`;
    $("summary").innerHTML =
      `Capital splits <b>${anchor}%</b> into <b>${aLab}</b> and <b>${p.enginePct}%</b> rotating between TQQQ and SQQQ by a 0–1 hedge score ` +
      `(+${p.wTrend} below ${p.smaWindow}d SMA, +${p.wVol} if ${p.volWindow}d vol &gt; ${p.volThresh}%, +${p.wRsiHot} if RSI&gt;${p.rsiOverheat}, ${p.wRsiCold} if RSI&lt;${p.rsiOversold}). ` +
      `${whip} ${veto} ${safety} ${cadence}, ${timing}; ${sweep}. Costs <b>${p.tradingCostBps} bps</b>/rebalance. ${taxLine}`;
  }

  const NUM_FIELDS = {
    adxthreshold: "adxThresh", adxthresh: "adxThresh", adx: "adxThresh", erthreshold: "erThresh", efficiency: "erThresh", er: "erThresh",
    vixthresh: "vixThresh", vix: "vixThresh", engine: "enginePct", bull: "enginePct", leverage: "enginePct",
    sma: "smaWindow", trend: "smaWindow", volthresh: "volThresh", volatility: "volThresh", vol: "volThresh",
    overbought: "rsiOverheat", overheat: "rsiOverheat", oversold: "rsiOversold",
    cost: "tradingCostBps", commission: "tradingCostBps", bps: "tradingCostBps", fee: "extraMgmtFeePct",
    yield: "anchorYield", income: "anchorYield", riskfree: "riskFreePct", capital: "initialCapital",
    band: "rebalanceBand", "short-term": "stRate", shortterm: "stRate", "long-term": "ltRate", longterm: "ltRate", incometax: "incomeRate"
  };
  function num1(s) { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; }
  function parseNL(text) {
    const t = " " + text.toLowerCase().replace(/[%,$]/g, " ").replace(/\s+/g, " ") + " ";
    const patch = {};
    if (/\b(reset|default)/.test(t)) return { __reset: true };
    if (/signal[- ]?driven|signal mode|trade on (drift|change)/.test(t)) patch.rebalance = "signal";
    else if (/\bdaily\b/.test(t)) patch.rebalance = "daily";
    else if (/\bweekly\b/.test(t)) patch.rebalance = "weekly";
    else if (/\bmonthly\b/.test(t)) patch.rebalance = "monthly";
    if (/before close|same.?day close|near close|sameclose/.test(t)) patch.executeTiming = "sameClose";
    else if (/next open|next.?day open/.test(t)) patch.executeTiming = "nextOpen";
    if (/tax[- ]?advantaged|ira|401k|roth|no tax/.test(t)) patch.accountType = "taxAdvantaged";
    else if (/taxable|brokerage|after.?tax/.test(t)) patch.accountType = "taxable";
    const am = t.match(/\b(?:anchor|use|switch to|swap to|set anchor to)\s+(jepq|jepi|qyld|schd|bil|adx|adams)\b/) || t.match(/\b(jepq|jepi|qyld|schd|bil|adams)\b/);
    if (am) { const ak = am[1] === "adams" ? "adx" : am[1]; patch.anchorKey = ak; patch.anchorYield = AINFO[ak] ? AINFO[ak].yield_ : undefined; }
    if (/\bwhipsaw\b|\bchop/.test(t)) patch.whipsaw = !/\b(off|disable|stop|no)\b/.test(t);
    if (/efficiency ratio only|\ber only\b/.test(t)) patch.whipsawDetector = "er";
    else if (/adx only/.test(t)) patch.whipsawDetector = "adx";
    else if (/\beither\b/.test(t)) patch.whipsawDetector = "either";
    const onoff = re => { const m = t.match(re); if (!m) return null; const seg = t.slice(Math.max(0, m.index - 12), m.index + m[0].length + 6); return /\b(off|disable|stop|no|without|remove)\b/.test(seg) ? false : true; };
    let v;
    if ((v = onoff(/safety switch|vix switch/)) !== null) patch.safetySwitch = v;
    if ((v = onoff(/\bveto\b/)) !== null) patch.vetoRsiOversold = v;
    if (/route|sweep|reinvest/.test(t) && /income/.test(t)) patch.jepqRouteIncome = onoff(/income/) !== false;
    let m;
    if ((m = t.match(/from\s+((19|20)\d\d)(-\d\d-\d\d)?/))) patch.startDate = m[3] ? m[1] + m[3] : m[1] + "-01-01";
    if ((m = t.match(/(end date|until|through)\s+((19|20)\d\d)(-\d\d-\d\d)?/))) patch.endDate = m[4] ? m[2] + m[4] : m[2] + "-12-31";
    const keys = Object.keys(NUM_FIELDS).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      const idx = t.indexOf(k); if (idx < 0) continue;
      const field = NUM_FIELDS[k]; if (patch[field] !== undefined) continue;
      const after = t.slice(idx + k.length, idx + k.length + 24);
      let n = num1(after); if (n === null) { const before = t.slice(Math.max(0, idx - 14), idx); n = num1(before); }
      if (n !== null) patch[field] = n;
    }
    return patch;
  }
  function clampPatch(patch) {
    const out = {}, notes = [];
    for (const [k, val] of Object.entries(patch)) {
      if (k === "__reset") { out.__reset = true; continue; }
      if (!(k in DEFAULTS) || val === undefined) continue;
      let v = val;
      if (typeof DEFAULTS[k] === "number") { v = +v; if (isNaN(v)) continue; if (RANGES[k]) { const [lo, hi] = RANGES[k]; v = Math.max(lo, Math.min(hi, v)); } }
      out[k] = v; notes.push(`${k} = ${typeof v === "number" ? v : "" + v}`);
    }
    return { out, notes };
  }
  function applyPatch(patch, source) {
    const { out, notes } = clampPatch(patch);
    if (out.__reset) { params = structuredClone(DEFAULTS); prevAnchor = params.anchorKey; buildControls(); updateSummary(); persist(); run(); return setNL("Reset to defaults."); }
    if (!notes.length) return setNL(`Couldn't map that. Try "anchor schd", "signal-driven rebalance", "tax-advantaged", "short-term 25", "engine 80%".`, true);
    params = { ...readParams(), ...out };
    if (params.anchorKey !== prevAnchor) prevAnchor = params.anchorKey;
    syncControlsAfterPatch(); updateSummary(); persist(); run();
    setNL(`Applied via ${source}: ${notes.join("; ")}.`);
  }
  function syncControlsAfterPatch() {
    GROUPS.forEach(g => g.items.forEach(it => {
      if (it.type === "lookup") return;
      const el = $("c_" + it.key); if (!el) return;
      if (it.type === "switch") el.checked = !!params[it.key]; else el.value = params[it.key];
      if (it.type === "slider") sliderOut(it.key, el.value, it.suffix);
    }));
  }
  function setNL(msg, warn) { const el = $("nlStatus"); el.innerHTML = msg; el.style.color = warn ? "var(--red)" : "var(--muted)"; }
  async function applyNL() {
    const text = $("nlInput").value.trim(); if (!text) return;
    setNL("Interpreting&hellip;");
    if (window.cowork && typeof window.cowork.askClaude === "function") {
      try {
        const schema = Object.keys(DEFAULTS).filter(k => k !== "lookup").map(k => k + (RANGES[k] ? `[${RANGES[k][0]}..${RANGES[k][1]}]` : "")).join(", ");
        const prompt =
          `Translate a plain-English request into a JSON patch of strategy parameters.\nAllowed keys: ${schema}. ` +
          `Booleans: vetoRsiOversold, safetySwitch, jepqRouteIncome, whipsaw. anchorKey in ${ANCHOR_KEYS.join("|")} (adx=Adams equity fund). ` +
          `rebalance is "weekly"|"monthly"|"daily"|"signal". executeTiming is "nextOpen"|"sameClose". accountType is "taxable"|"taxAdvantaged". ` +
          `whipsawDetector is "both"|"either"|"adx"|"er". enginePct=% in TQQQ/SQQQ (rest is anchor).\nCurrent: ${JSON.stringify(readParams())}.\nRequest: "${text}".\nReply with ONLY a JSON object of keys to change.`;
        const res = await window.cowork.askClaude(prompt, []);
        const txt = typeof res === "string" ? res : (res && (res.text || res.content || JSON.stringify(res)));
        const mm = txt && txt.match(/\{[\s\S]*\}/);
        if (mm) return applyPatch(JSON.parse(mm[0]), "AI");
        return applyPatch(parseNL(text), "parser");
      } catch (e) { return applyPatch(parseNL(text), "parser"); }
    }
    applyPatch(parseNL(text), "parser");
  }

  // build one full run with pretax + after-tax (display) metrics
  function buildRun(p) {
    p = { ...DEFAULTS, ...p };
    const bt = E.runBacktest(D, p);
    if (bt.error) return { error: bt.error };
    const taxable = p.accountType === "taxable";
    const eq = taxable ? bt.equityAT : bt.equity;
    const qqqBH = E.buyHold(D.qqq, D.dates, bt.dates, p.initialCapital);
    const tqqqBH = E.buyHold(D.tqqq, D.dates, bt.dates, p.initialCapital);
    const qqqDisp = taxable ? E.buyHoldAfterTax(qqqBH, p) : qqqBH;
    const tqqqDisp = taxable ? E.buyHoldAfterTax(tqqqBH, p) : tqqqBH;
    const benchRet = E.seriesReturns(qqqDisp);
    return {
      bt, taxable, eq, eqPre: bt.equity, qqqDisp, tqqqDisp,
      m: E.metrics(eq, bt.dates, benchRet, p),
      mPre: E.metrics(bt.equity, bt.dates, E.seriesReturns(qqqBH), p),
      mQ: E.metrics(qqqDisp, bt.dates, benchRet, p),
      mQpre: E.metrics(qqqBH, bt.dates, E.seriesReturns(qqqBH), p),
      mT: E.metrics(tqqqDisp, bt.dates, E.seriesReturns(tqqqDisp), p),
      mTpre: E.metrics(tqqqBH, bt.dates, E.seriesReturns(tqqqBH), p),
      qFinalPre: qqqBH[qqqBH.length - 1], tFinalPre: tqqqBH[tqqqBH.length - 1]
    };
  }
  function run() {
    const now = () => (window.performance && performance.now) ? performance.now() : Date.now();
    const t0 = now();
    try {
      const p = readParams();
      const cur = buildRun(p);
      if (cur.error) { setNL(cur.error, true); const s0 = $("runStamp"); if (s0) s0.textContent = cur.error; return; }
      const versionRuns = versions.map(v => ({ v, run: buildRun(v.params) })).filter(x => !x.run.error);
      lastRun = { p, cur, versionRuns };
      renderKPIs(cur); renderChart(currentChartType); renderTable(); renderSignal(p); renderVersionChips(); renderCompareSel();
      const s = $("runStamp"); if (s) s.textContent = "Updated " + new Date().toLocaleTimeString() + " · " + Math.round(now() - t0) + " ms";
    } catch (e) {
      const s = $("runStamp"); if (s) s.textContent = "Error: " + e.message;
      setNL("Backtest error: " + e.message + " (press F12 → Console for details)", true);
      if (window.console) console.error(e);
    }
  }

  function renderKPIs(cur) {
    const m = cur.m, mQ = cur.mQ, beat = m.cagr - mQ.cagr, tx = cur.taxable;
    const items = [
      ["Final value" + (tx ? " (after-tax)" : ""), money(m.finalValue), moneyShort(m.finalValue)],
      ["CAGR" + (tx ? " (after-tax)" : ""), pct(m.cagr), (beat >= 0 ? "+" : "") + pct1(beat) + " vs QQQ"],
      ["Max drawdown", pct(m.maxDD), "Calmar " + num(m.calmar)],
      ["Sharpe", num(m.sharpe), "Sortino " + num(m.sortino)],
      ["Volatility", pct(m.volA), "ann."],
      tx ? ["Tax drag", pct(cur.mPre.cagr - m.cagr) + "/yr", "pretax CAGR " + pct(cur.mPre.cagr)]
         : ["Total return", pct(m.totalReturn, 0), m.years.toFixed(1) + " yrs"],
      ["Alpha vs QQQ", pct(m.alpha), "&beta; " + num(m.beta)],
      ["Worst year", pct(m.worstYear), "best " + pct(m.bestYear)]
    ];
    $("kpis").innerHTML = items.map(([k, v, s]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div><div class="k" style="text-transform:none;color:var(--muted)">${s}</div></div>`).join("");
  }

  const proxyLine = {
    id: "proxyLine",
    afterDraw(c) {
      if (!["equity", "drawdown", "alloc"].includes(currentChartType)) return;
      const ak = lastRun ? lastRun.p.anchorKey : "jepq";
      const ai = AINFO[ak]; if (!ai || !ai.realStart || ai.realStart <= META.start) return;
      const x = c.scales.x; if (!x) return;
      const px = x.getPixelForValue(ai.realStart);
      if (!px || px < x.left || px > x.right) return;
      const ctx = c.ctx, top = c.chartArea.top, bot = c.chartArea.bottom;
      ctx.save(); ctx.strokeStyle = "#94a3b8"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bot); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = cssVar("--tick"); ctx.font = "10px sans-serif";
      ctx.fillText("← " + ALABEL(ak) + " proxy", px - 78, top + 11); ctx.fillText("real →", px + 4, top + 11);
      ctx.restore();
    }
  };
  function sampleIdx(n, target) {
    if (n <= target) return Array.from({ length: n }, (_, i) => i);
    const step = (n - 1) / (target - 1), out = [];
    for (let i = 0; i < target; i++) out.push(Math.round(i * step));
    return out;
  }
  function alignToDates(masterDates, srcDates, srcVals) {
    const map = new Map(); srcDates.forEach((d, i) => map.set(d, srcVals[i]));
    return masterDates.map(d => map.has(d) ? map.get(d) : null);
  }
  function renderChart(type) {
    currentChartType = type;
    document.querySelectorAll("#chartTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.chart === type));
    if (chart) { chart.destroy(); chart = null; }
    if (!lastRun) return;
    if (type === "annual") return renderAnnual();
    const { cur, versionRuns, p } = lastRun;
    const master = cur.bt.dates, idx = sampleIdx(master.length, 800);
    const labels = idx.map(i => master[i]); const pick = arr => idx.map(i => arr[i]);
    const ds = [];
    if (type === "equity" || type === "drawdown") {
      const mk = (label, dates, vals, color, width) => {
        const series = type === "equity" ? vals : E.drawdownSeries(vals);
        return { label, data: pick(alignToDates(master, dates, series)), borderColor: color, backgroundColor: type === "drawdown" ? color + "22" : "transparent", borderWidth: width || 1.6, pointRadius: 0, fill: type === "drawdown", tension: 0, spanGaps: true };
      };
      ds.push(mk("Strategy", master, cur.eq, cssVar("--ink"), 2.2));
      versionRuns.forEach(vr => { if (compare.ver[vr.v.id] !== false) ds.push(mk(vr.v.name, vr.run.bt.dates, vr.run.eq, vr.v.color, 1.5)); });
      if (compare.qqq) ds.push(mk("QQQ", master, cur.qqqDisp, "#64748b", 1.4));
      if (compare.tqqq) ds.push(mk("TQQQ", master, cur.tqqqDisp, "#94a3b8", 1.2));
    } else if (type === "alloc") {
      const w = cur.bt.wHist;
      const series = (sel, color, label) => ({ label, data: pick(w.map(x => x[sel] * 100)), borderColor: color, backgroundColor: color + "cc", borderWidth: 0, pointRadius: 0, fill: true, tension: 0, stack: "a" });
      ds.push(series("tqqq", "#2563eb", "TQQQ"));
      ds.push(series("sqqq", "#dc2626", "SQQQ"));
      ds.push(series("tlt", "#7c3aed", "TLT"));
      ds.push(series("jepq", "#16a34a", ALABEL(p.anchorKey)));
    }
    const isDD = type === "drawdown", isAlloc = type === "alloc";
    chart = new Chart($("mainChart"), {
      type: "line", data: { labels, datasets: ds }, plugins: [proxyLine],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "category", ticks: { maxTicksLimit: 10, autoSkip: true, color: cssVar("--tick"), font: { size: 10 } }, grid: { display: false } },
          y: isAlloc ? { stacked: true, min: 0, max: 100, ticks: { callback: v => v + "%", color: cssVar("--tick"), font: { size: 10 } }, grid: { color: cssVar("--grid") } }
            : isDD ? { ticks: { callback: v => (v * 100).toFixed(0) + "%", color: cssVar("--tick"), font: { size: 10 } }, grid: { color: cssVar("--grid") } }
            : { type: $("logScale").checked ? "logarithmic" : "linear", ticks: { callback: v => moneyShort(v), color: cssVar("--tick"), font: { size: 10 } }, grid: { color: cssVar("--grid") } }
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, font: { size: 11 }, color: cssVar("--ink"), usePointStyle: true } },
          tooltip: { callbacks: { label: c => isAlloc ? `${c.dataset.label}: ${c.parsed.y == null ? "" : c.parsed.y.toFixed(0)}%` : isDD ? `${c.dataset.label}: ${c.parsed.y == null ? "" : (c.parsed.y * 100).toFixed(1)}%` : `${c.dataset.label}: ${c.parsed.y == null ? "" : money(c.parsed.y)}` } }
        }
      }
    });
    const taxTag = cur.taxable ? "After-tax. " : "";
    $("chartNote").innerHTML = isAlloc ? "Stacked sleeve weights over time. Flat TLT spans are the whipsaw filter parking the engine."
      : isDD ? taxTag + "Peak-to-trough decline vs benchmarks."
      : taxTag + "Growth of " + money(lastRun.p.initialCapital) + ". Dashed line marks where the anchor's real data begins.";
  }
  function renderAnnual() {
    const { cur } = lastRun;
    const years = Object.keys(cur.m.yearReturns);
    const bar = (label, mm, color) => ({ label, data: years.map(y => (mm.yearReturns[y] ?? null) * 100), backgroundColor: color, borderWidth: 0, categoryPercentage: 0.8, barPercentage: 0.9 });
    const sets = [bar("Strategy", cur.m, cssVar("--ink"))];
    if (compare.qqq) sets.push(bar("QQQ", cur.mQ, "#64748b"));
    if (compare.tqqq) sets.push(bar("TQQQ", cur.mT, "#cbd5e1"));
    chart = new Chart($("mainChart"), {
      type: "bar", data: { labels: years, datasets: sets },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { grid: { display: false }, ticks: { color: cssVar("--tick"), font: { size: 10 } } }, y: { ticks: { callback: v => v + "%", color: cssVar("--tick"), font: { size: 10 } }, grid: { color: cssVar("--grid") } } },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, color: cssVar("--ink"), usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y == null ? "n/a" : c.parsed.y.toFixed(1) + "%"}` } } } }
    });
    $("chartNote").innerHTML = (cur.taxable ? "After-tax c" : "C") + "alendar-year returns vs benchmarks.";
  }

  const METRICS = [
    ["finalValue", "Final value", "money", 1], ["totalReturn", "Total return", "pct0", 1],
    ["cagr", "CAGR", "pct", 1], ["volA", "Volatility (ann.)", "pct", -1],
    ["sharpe", "Sharpe", "num", 1], ["sortino", "Sortino", "num", 1],
    ["maxDD", "Max drawdown", "pct", 1], ["calmar", "Calmar", "num", 1],
    ["beta", "Beta vs QQQ", "num", 0], ["alpha", "Alpha vs QQQ (ann.)", "pct", 1],
    ["upCap", "Up capture", "pctRaw", 1], ["dnCap", "Down capture", "pctRaw", -1],
    ["bestYear", "Best year", "pct", 1], ["worstYear", "Worst year", "pct", 1],
    ["posDays", "Positive days", "pct", 1], ["var95", "Daily VaR 95%", "pct", 1], ["cvar95", "Daily CVaR 95%", "pct", 1]
  ];
  function fmtMetric(kind, v) {
    if (v == null || isNaN(v)) return "&mdash;";
    if (kind === "money") return moneyShort(v);
    if (kind === "pct") return pct(v);
    if (kind === "pct0") return pct(v, 0);
    if (kind === "pctRaw") return v.toFixed(0) + "%";
    return v.toFixed(2);
  }
  function renderTable() {
    const { cur, versionRuns } = lastRun;
    const taxable = cur.taxable;
    const cols = [{ name: "Strategy", m: cur.m, mPre: cur.mPre, st: cur.bt.stats, tax: cur.bt.tax, strat: true }];
    versionRuns.forEach(vr => { if (compare.ver[vr.v.id] !== false) cols.push({ name: vr.v.name, m: vr.run.m, mPre: vr.run.mPre, st: vr.run.bt.stats, tax: vr.run.bt.tax, strat: true, color: vr.v.color }); });
    if (compare.qqq) cols.push({ name: "QQQ", m: cur.mQ, mPre: cur.mQpre, benchTax: cur.qFinalPre - cur.mQ.finalValue });
    if (compare.tqqq) cols.push({ name: "TQQQ", m: cur.mT, mPre: cur.mTpre, benchTax: cur.tFinalPre - cur.mT.finalValue });
    let head = `<thead><tr><th>Metric</th>${cols.map(c => `<th>${c.color ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c.color};margin-right:4px"></span>` : ""}${c.name}</th>`).join("")}</tr></thead>`;
    let body = "<tbody>";
    for (const [key, label, kind, dir] of METRICS) {
      const vals = cols.map(c => c.m[key]);
      let best = null, worst = null;
      if (dir !== 0) {
        const valid = vals.map((v, i) => [v, i]).filter(([v]) => v != null && !isNaN(v));
        if (valid.length > 1) {
          const scored = valid.map(([v, i]) => [(key === "maxDD" || key === "var95" || key === "cvar95") ? v : v * dir, i]);
          best = scored.reduce((a, b) => b[0] > a[0] ? b : a)[1];
          worst = scored.reduce((a, b) => b[0] < a[0] ? b : a)[1];
        }
      }
      body += `<tr><td class="metric-name">${label}</td>` + vals.map((v, i) => `<td class="${i === best ? "cell-best" : i === worst ? "cell-worst" : ""}">${fmtMetric(kind, v)}</td>`).join("") + "</tr>";
    }
    const exRow = (label, fn, sub) => { body += `<tr><td class="metric-name">${label}${sub ? `<small>${sub}</small>` : ""}</td>` + cols.map(fn).join("") + "</tr>"; };
    if (taxable) {
      exRow("Pretax CAGR", c => `<td>${pct(c.mPre.cagr)}</td>`, "before taxes");
      exRow("Total taxes paid", c => `<td>${c.strat ? moneyShort(c.tax.total) : (c.benchTax != null ? moneyShort(c.benchTax) : "&mdash;")}</td>`);
      exRow("% gains short-term", c => `<td>${c.strat ? pct(c.tax.pctShortTerm) : "~0%"}</td>`, "leveraged-ETF tax penalty");
    }
    exRow("Avg SQQQ / TLT hedge", c => `<td>${c.st ? (c.st.avgSqqq * 100).toFixed(1) + "% / " + (c.st.avgTlt * 100).toFixed(1) + "%" : "&mdash;"}</td>`, "strategy only");
    exRow("% time hedged", c => `<td>${c.st ? (c.st.pctHedged * 100).toFixed(0) + "%" : "&mdash;"}</td>`);
    exRow("Rebalances / cost", c => `<td>${c.st ? c.st.rebalCount + " / " + moneyShort(c.st.costSum) : "&mdash;"}</td>`);
    body += "</tbody>";
    $("cmpTable").innerHTML = head + body;
    const tn = $("taxNote");
    if (tn) {
      if (taxable) { tn.style.display = ""; tn.innerHTML = `Showing <b>after-tax</b> results for a <b>taxable</b> account (ST ${lastRun.p.stRate}%, LT ${lastRun.p.ltRate}%, income ${lastRun.p.incomeRate}%). Benchmarks defer to one long-term sale, so they look far more tax-efficient. Switch <b>Account type</b> to tax-advantaged for pretax.`; }
      else tn.style.display = "none";
    }
  }
  function renderCompareSel() {
    const { versionRuns } = lastRun;
    const cb = (id, label, checked, color) => `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><input type="checkbox" data-cmp="${id}" ${checked ? "checked" : ""}>${color ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color}"></span>` : ""}${label}</label>`;
    let html = "<b>Compare:</b> ";
    versionRuns.forEach(vr => { html += cb("ver:" + vr.v.id, vr.v.name, compare.ver[vr.v.id] !== false, vr.v.color); });
    html += cb("qqq", "QQQ", compare.qqq) + cb("tqqq", "TQQQ", compare.tqqq);
    $("compareSel").innerHTML = html;
    document.querySelectorAll("[data-cmp]").forEach(el => el.onchange = () => {
      const id = el.dataset.cmp;
      if (id === "qqq") compare.qqq = el.checked;
      else if (id === "tqqq") compare.tqqq = el.checked;
      else if (id.startsWith("ver:")) compare.ver[id.slice(4)] = el.checked;
      renderChart(currentChartType); renderTable();
    });
  }
  function renderSignal(p) {
    const ind = lastRun.cur.bt.ind;
    const i = D.dates.length - 1;
    const tw = E.targetWeights(i, ind, D, p);
    const [state, color] = stateForScore(tw.h);
    const aLab = ALABEL(p.anchorKey);
    $("sigState").innerHTML = `<span class="dot" style="background:${color}"></span>${tw.whip ? "Whipsaw &rarr; TLT" : state}`;
    $("sigScore").textContent = tw.h.toFixed(2);
    $("signalAsOf").textContent = "(as of " + D.dates[i] + ")";
    const segs = [["TQQQ", tw.tqqq, "#2563eb"], ["SQQQ", tw.sqqq, "#dc2626"], ["TLT", tw.tlt, "#7c3aed"], [aLab, tw.jepq, "#16a34a"]].filter(s => s[1] > 0.001);
    $("sigAlloc").innerHTML = segs.map(([n, w, c]) => `<span style="width:${(w * 100).toFixed(1)}%;background:${c}">${w >= 0.08 ? n + " " + (w * 100).toFixed(0) + "%" : ""}</span>`).join("");
    const parts = [`Trend ${tw.price < tw.sma ? "below" : "above"} ${p.smaWindow}d`, `vol ${tw.vol == null ? "?" : tw.vol.toFixed(0)}%`, `RSI ${tw.rsi == null ? "?" : tw.rsi.toFixed(0)}`, `ADX ${tw.adx == null ? "?" : tw.adx.toFixed(0)}`, `ER ${tw.er == null ? "?" : tw.er.toFixed(2)}`, `VIX ${tw.vix == null ? "?" : tw.vix.toFixed(0)}`];
    if (tw.whip) parts.push("<b>whipsaw&rarr;TLT</b>");
    if (tw.safety) parts.push("<b>VIX safety&rarr;TLT</b>");
    if (tw.vetoed) parts.push("<b>oversold veto</b>");
    $("sigBreak").innerHTML = segs.map(([n, w, c]) => `<span style="color:${c};font-weight:700">${n} ${(w * 100).toFixed(0)}%</span>`).join(" &middot; ") + " &nbsp;|&nbsp; " + parts.join(" &middot; ");
    let j = i - 1; while (j > 0 && E.dow(D.dates[j + 1]) >= E.dow(D.dates[j])) j--;
    const prev = E.targetWeights(j, ind, D, p);
    const drift = Math.abs(prev.tqqq - tw.tqqq) + Math.abs(prev.sqqq - tw.sqqq) + Math.abs(prev.tlt - tw.tlt) + Math.abs(prev.jepq - tw.jepq);
    $("sigRebal").innerHTML = drift > 0.005 ? `<span style="color:var(--red)">&#9679; Rebalance signalled</span>` : `<span style="color:var(--green)">&#9679; No change needed</span>`;
  }

  function renderVersionChips() {
    $("versionChips").innerHTML = (versions.length ? "" : `<span class="hint">No saved versions yet — tweak the strategy and click "Save as new". Click a saved chip to load &amp; edit it.</span>`) +
      versions.map(v => `<span class="chip" style="${editingVersionId === v.id ? "outline:2px solid " + v.color : ""}"><span class="sw" style="background:${v.color}"></span><span data-load="${v.id}" style="cursor:pointer" title="load &amp; edit">${v.name}</span><button data-del="${v.id}" title="remove">&times;</button></span>`).join("") +
      (storageBlocked ? `<span class="hint" style="display:block;margin-top:8px;color:var(--amber)">Browser storage is blocked in this view, so saved versions won't survive a reload. Use &ldquo;Export all (.json)&rdquo; to keep them, then &ldquo;Import&rdquo; on the hosted site.</span>` : "");
    document.querySelectorAll("[data-load]").forEach(el => el.onclick = () => loadVersion(el.dataset.load));
    document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      versions = versions.filter(v => v.id !== b.dataset.del);
      if (editingVersionId === b.dataset.del) { editingVersionId = null; $("btnUpdate").style.display = "none"; }
      persist(); run();
    });
    const cfgSel = $("cfgVerSel");
    if (cfgSel) { const keep = cfgSel.value; cfgSel.innerHTML = cfgVerOptions(); if ([...cfgSel.options].some(o => o.value === keep)) cfgSel.value = keep; }
  }
  function loadVersion(id) {
    const v = versions.find(x => x.id === id); if (!v) return;
    params = { ...DEFAULTS, ...structuredClone(v.params) }; prevAnchor = params.anchorKey; editingVersionId = id;
    buildControls(); updateSummary(); persist(); run();
    $("btnUpdate").style.display = ""; $("btnUpdate").textContent = "Update “" + v.name + "”";
    setNL(`Loaded "${v.name}" into the controls — edit and click "Update" to save changes, or "Save as new".`);
  }
  function saveVersion() {
    const n = versions.length + 1;
    const name = prompt("Name this version:", "v" + n) || ("v" + n);
    const id = "v" + Date.now();
    versions.push({ id, name, color: PALETTE[(versions.length + 1) % PALETTE.length], params: readParams() });
    compare.ver[id] = true; editingVersionId = id;
    $("btnUpdate").style.display = ""; $("btnUpdate").textContent = "Update “" + name + "”";
    persist(); run();
  }
  function updateVersion() {
    const v = versions.find(x => x.id === editingVersionId); if (!v) return;
    v.params = readParams(); persist(); run(); setNL(`Updated "${v.name}".`);
  }

  function persist() { try { localStorage.setItem("lrs_state_v4", JSON.stringify({ params: readParams(), versions, compare, editingVersionId })); } catch (e) { storageBlocked = true; } }
  function restore() {
    try { localStorage.setItem("lrs_probe", "1"); localStorage.removeItem("lrs_probe"); } catch (e) { storageBlocked = true; }
    try {
      let s = JSON.parse(localStorage.getItem("lrs_state_v4"));
      let migrated = false;
      if (!s) { for (const k of ["lrs_state_v3", "lrs_state_v2"]) { const o = JSON.parse(localStorage.getItem(k)); if (o && (o.params || (o.versions && o.versions.length))) { s = o; migrated = true; break; } } }
      if (s) {
        if (s.params) params = { ...DEFAULTS, ...s.params };
        prevAnchor = params.anchorKey; versions = s.versions || []; compare = s.compare || compare; editingVersionId = s.editingVersionId || null;
        if (migrated) try { localStorage.setItem("lrs_state_v4", JSON.stringify({ params, versions, compare, editingVersionId })); } catch (e) {}
      }
    } catch (e) {}
  }
  function exportVersions() {
    const blob = new Blob([JSON.stringify({ versions, params: readParams(), savedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "strategy_versions.json"; a.click();
    setNL(versions.length + " version(s) exported. Import this file on the other dashboard (e.g. the hosted site) to carry them over.");
  }
  function importFile(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let obj = null; const text = rd.result;
      try { obj = JSON.parse(text); } catch (_) { const m = text.match(/```json\s*([\s\S]*?)```/); if (m) { try { obj = JSON.parse(m[1]); } catch (e) {} } }
      if (!obj) { setNL("Couldn't read a strategy from that file.", true); return; }
      let incoming = obj.versions || (Array.isArray(obj) ? obj : (obj.params ? [obj] : (obj.enginePct != null ? [{ name: f.name.replace(/\.[^.]+$/, ""), params: obj }] : [])));
      let n = 0;
      incoming.forEach(v => { if (v && v.params) { const id = "v" + Date.now() + "_" + (n++); versions.push({ id, name: v.name || ("import" + n), color: v.color || PALETTE[versions.length % PALETTE.length], params: { ...DEFAULTS, ...v.params } }); compare.ver[id] = true; } });
      if (n) { persist(); run(); setNL("Imported " + n + " version(s)."); } else setNL("No strategy versions found in that file.", true);
    };
    rd.readAsText(f); ev.target.value = "";
  }
  function reportRows(p) {
    return [
      ["Backtest window", p.startDate + " to " + p.endDate],
      ["Starting capital", "$" + (+p.initialCapital).toLocaleString()],
      ["Engine / anchor", p.enginePct + "% TQQQ-SQQQ / " + (100 - p.enginePct) + "% " + ALABEL(p.anchorKey) + " (yield " + p.anchorYield + "%)"],
      ["Rebalance", p.rebalance + ", " + (p.executeTiming === "sameClose" ? "~15m before close" : "next open") + (p.rebalance === "signal" ? ", band " + p.rebalanceBand + "%" : "")],
      ["Trend / vol / RSI", "SMA " + p.smaWindow + "d; vol>" + p.volThresh + "% (win " + p.volWindow + "); RSI(" + p.rsiWindow + ") OB " + p.rsiOverheat + "/OS " + p.rsiOversold],
      ["Hedge weights", "trend " + p.wTrend + ", vol " + p.wVol + ", OB " + p.wRsiHot + ", OS " + p.wRsiCold],
      ["Whipsaw filter", p.whipsaw ? "ON (" + p.whipsawDetector + "; ADX<" + p.adxThresh + ", ER<" + p.erThresh + ")" : "off"],
      ["VIX safety / veto", (p.safetySwitch ? "VIX>" + p.vixThresh + " to TLT" : "off") + " / " + (p.vetoRsiOversold ? "oversold veto on" : "off")],
      ["Anchor income", p.jepqRouteIncome ? "swept into TQQQ" : "kept in anchor"],
      ["Account / taxes", p.accountType === "taxable" ? "Taxable (ST " + p.stRate + "%, LT " + p.ltRate + "%, income " + p.incomeRate + "%)" : "Tax-advantaged (no tax)"],
      ["Costs", p.tradingCostBps + " bps/rebalance" + (p.extraMgmtFeePct > 0 ? ", " + p.extraMgmtFeePct + "%/yr fee" : "")]
    ];
  }
  function metricRows() {
    if (!lastRun) return [];
    const m = lastRun.cur.m, taxable = lastRun.cur.taxable;
    const rows = [
      ["CAGR" + (taxable ? " (after-tax)" : ""), pct(m.cagr)],
      ["Final value", money(m.finalValue)],
      ["Total return", pct(m.totalReturn, 0)],
      ["Volatility (ann.)", pct(m.volA)],
      ["Sharpe / Sortino", num(m.sharpe) + " / " + num(m.sortino)],
      ["Max drawdown / Calmar", pct(m.maxDD) + " / " + num(m.calmar)],
      ["Beta / Alpha vs QQQ", num(m.beta) + " / " + pct(m.alpha)],
      ["Best / worst year", pct(m.bestYear) + " / " + pct(m.worstYear)]
    ];
    if (taxable) { rows.push(["Pretax CAGR / tax drag", pct(lastRun.cur.mPre.cagr) + " / " + pct(lastRun.cur.mPre.cagr - m.cagr)]); rows.push(["Total taxes / % short-term", moneyShort(lastRun.cur.bt.tax.total) + " / " + pct(lastRun.cur.bt.tax.pctShortTerm)]); }
    return rows;
  }
  function buildMd() {
    const p = readParams(), sum = ($("summary").textContent || "").trim();
    const tbl = rows => rows.map(r => "| " + r[0] + " | " + r[1] + " |").join("\n");
    return "# Leveraged Rotation Strategy - configuration\n\n_Generated " + new Date().toLocaleString() + " from the dashboard._\n\n## Plain-English rules\n\n" + sum +
      "\n\n## Parameters\n\n| Setting | Value |\n|---|---|\n" + tbl(reportRows(p)) +
      "\n\n## Backtest results (" + p.startDate + " to " + p.endDate + ")\n\n| Metric | Value |\n|---|---|\n" + tbl(metricRows()) +
      "\n\n> Anchors before launch use a calibrated proxy. Taxes are modeled (average-cost, yearly). Educational backtest - not investment advice.\n\n<!-- machine-readable; do not edit -->\n```json\n" + JSON.stringify(p) + "\n```\n";
  }
  function exportMarkdown() {
    const blob = new Blob([buildMd()], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "strategy.md"; a.click();
    setNL("Exported strategy.md - human-readable and re-importable.");
  }
  function savePDF() {
    const w = window.open("", "_blank"); if (!w) { setNL("Pop-up blocked - allow pop-ups to save as PDF.", true); return; }
    const p = readParams();
    const tbl = rows => "<table>" + rows.map(r => "<tr><td><b>" + r[0] + "</b></td><td>" + r[1] + "</td></tr>").join("") + "</table>";
    const html = "<h1>Leveraged Rotation Strategy</h1><p style='color:#666'>Generated " + new Date().toLocaleString() + "</p>" +
      "<h2>Plain-English rules</h2><p>" + ($("summary").innerHTML || "") + "</p>" +
      "<h2>Parameters</h2>" + tbl(reportRows(p)) +
      "<h2>Backtest results (" + p.startDate + " to " + p.endDate + ")</h2>" + tbl(metricRows()) +
      "<p style='color:#666;font-size:11px'>Anchors before launch use a calibrated proxy. Taxes are modeled. Educational - not investment advice.</p>";
    w.document.write("<html><head><title>Strategy</title><style>body{font:13px/1.6 -apple-system,Segoe UI,Arial;max-width:760px;margin:24px auto;padding:0 16px;color:#161a22}h1{font-size:20px;margin:0}h2{font-size:14px;margin:16px 0 6px}table{border-collapse:collapse;width:100%}td{border:1px solid #e3e8ef;padding:5px 9px;font-size:12px;vertical-align:top}</style></head><body>" + html + "<scr" + "ipt>setTimeout(function(){window.print();},350);</scr" + "ipt></body></html>");
    w.document.close(); setNL("Opened a printable view - choose 'Save as PDF' in the print dialog.");
  }
  function exportConfig(p, label) {
    p = (p && p.enginePct != null) ? p : readParams();
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "strategy_config.json"; a.click();
    setNL('Exported strategy_config.json' + (label ? ' for the saved version "' + label + '"' : ' (current controls)') + " — commit it to alerts/ in your repo so the alert workflow monitors these exact parameters.");
  }
  function cfgVerOptions() { return ['<option value="__current">Current (live controls)</option>'].concat(versions.map(v => `<option value="${v.id}">${v.name}</option>`)).join(""); }
  function renderAlerts() {
    $("alertsHost").innerHTML =
      `<div class="callout">The dashboard runs <b>inside a sandbox</b> and cannot send messages itself. Live alerts run on <b>GitHub Actions</b>, which re-checks this exact signal logic on a schedule and emails/Telegrams you only when the target allocation changes.</div>
      <div class="two-col"><div><b>One-time setup</b>
      <ol style="margin:6px 0 0;padding-left:18px;line-height:1.7">
        <li>Push this folder to a GitHub repo.</li>
        <li>Settings &rarr; Secrets &rarr; Actions: add <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_CHAT_ID</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>ALERT_TO</code>.</li>
        <li>Enable Actions and (optionally) GitHub Pages.</li></ol></div>
      <div><b>What an alert looks like</b>
      <pre>ROTATION — REBALANCE
State: Weakness (score 0.30)
TQQQ 55% | SQQQ 15% | JEPQ 30%
(was TQQQ 70% | JEPQ 30%)</pre>
      <div style="margin-top:8px"><b>Export a strategy for the alert script</b><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center"><select id="cfgVerSel" style="min-width:200px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit"></select><button class="btn" id="btnExportCfg2">Export config for the alert script</button></div><div class="hint" style="margin-top:5px">The workflow watches one strategy at a time. Pick the current controls or any saved version.</div></div></div></div>`;
    $("cfgVerSel").innerHTML = cfgVerOptions();
    $("btnExportCfg2").onclick = () => {
      const id = $("cfgVerSel").value;
      if (id === "__current") return exportConfig();
      const v = versions.find(x => x.id === id);
      exportConfig(v ? { ...DEFAULTS, ...v.params } : null, v ? v.name : null);
    };
  }
  let paperCfg = { url: "", token: "" }, paperChart = null;
  function loadPaperCfg() { try { const c = JSON.parse(localStorage.getItem("lrs_paper")); if (c) paperCfg = c; } catch (e) {} }
  function savePaperCfg() { try { localStorage.setItem("lrs_paper", JSON.stringify(paperCfg)); } catch (e) {} }
  function currentTargets() {
    if (!lastRun) return [];
    const p = readParams(), ind = lastRun.cur.bt.ind;
    const tw = E.targetWeights(D.dates.length - 1, ind, D, p);
    return [["TQQQ", tw.tqqq], ["SQQQ", tw.sqqq], ["TLT", tw.tlt], [ALABEL(p.anchorKey), tw.jepq]].filter(x => x[1] > 0.001).map(x => ({ symbol: x[0], weight: +x[1].toFixed(4) }));
  }
  async function paperFetch(path, opts) {
    if (!paperCfg.url) throw new Error("Set your worker URL first.");
    const o = opts || {}; o.headers = Object.assign({ "content-type": "application/json" }, o.headers || {});
    if (paperCfg.token) o.headers["x-access-token"] = paperCfg.token;
    const r = await fetch(paperCfg.url.replace(/\/$/, "") + path, o);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  function setPaperStatus(msg, warn) { const e = $("paperStatus"); if (e) { e.innerHTML = msg; e.style.color = warn ? "var(--red)" : "var(--muted)"; } }
  async function paperConnect() {
    setPaperStatus("Connecting&hellip;");
    try { const d = await paperFetch("/account"); renderPaperAccount(d); setPaperStatus("Connected to your Alpaca paper account."); }
    catch (e) { setPaperStatus("Couldn't reach the worker: " + e.message + ". (Live trading works on the hosted site; this in-app preview can't reach external services.)", true); }
  }
  async function paperExecute() {
    const targets = currentTargets();
    if (!targets.length) { setPaperStatus("Run a backtest first.", true); return; }
    if (!window.confirm("Rebalance your Alpaca PAPER account to: " + targets.map(t => t.symbol + " " + Math.round(t.weight * 100) + "%").join(", ") + " ?")) return;
    setPaperStatus("Submitting orders&hellip;");
    try {
      const r = await paperFetch("/rebalance", { method: "POST", body: JSON.stringify({ targets }) });
      const okN = r.results.filter(x => x.ok).length, bad = r.results.filter(x => !x.ok);
      setPaperStatus("Rebalanced: " + okN + " order(s) ok" + (bad.length ? "; " + bad.length + " failed (" + bad.map(b => b.symbol + ": " + b.error).join("; ") + ")" : "") + ".", bad.length > 0);
      setTimeout(paperConnect, 1500);
    } catch (e) { setPaperStatus("Rebalance failed: " + e.message, true); }
  }
  function renderPaperAccount(d) {
    const host = $("paperAccount"); if (!host) return;
    const pl = d.last_equity ? d.equity - d.last_equity : 0, plpc = d.last_equity ? pl / d.last_equity : 0;
    const rows = (d.positions || []).map(p => "<tr><td style='text-align:left'>" + p.symbol + "</td><td>" + p.qty.toFixed(2) + "</td><td>" + money(p.market_value) + "</td><td style='color:" + (p.unrealized_pl >= 0 ? "var(--green)" : "var(--red)") + "'>" + money(p.unrealized_pl) + " (" + pct(p.unrealized_plpc) + ")</td></tr>").join("");
    host.innerHTML = "<div class='kpis' style='grid-template-columns:repeat(3,1fr)'>" +
      "<div class='kpi'><div class='v'>" + money(d.equity) + "</div><div class='k'>Paper equity</div></div>" +
      "<div class='kpi'><div class='v' style='color:" + (pl >= 0 ? "var(--green)" : "var(--red)") + "'>" + money(pl) + "</div><div class='k'>Today's P&amp;L (" + pct(plpc) + ")</div></div>" +
      "<div class='kpi'><div class='v'>" + money(d.cash) + "</div><div class='k'>Cash</div></div></div>" +
      (rows ? "<div class='scroll-x' style='margin-top:10px'><table class='cmp'><thead><tr><th style='text-align:left'>Position</th><th>Qty</th><th>Value</th><th>Unreal. P&amp;L</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
            : "<div class='legend-note' style='margin-top:8px'>No open positions yet &mdash; click Rebalance to deploy the current target allocation.</div>") +
      "<div class='chart-wrap short' style='height:200px;margin-top:10px'><canvas id='paperChart'></canvas></div>";
    if (d.history && d.history.equity && d.history.equity.length > 1) {
      const labels = d.history.timestamp.map(t => new Date(t * 1000).toISOString().slice(0, 10));
      if (paperChart) paperChart.destroy();
      paperChart = new Chart($("paperChart"), { type: "line", data: { labels, datasets: [{ label: "Paper equity", data: d.history.equity, borderColor: cssVar("--ink"), borderWidth: 1.8, pointRadius: 0, tension: 0, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, color: cssVar("--tick"), font: { size: 10 } }, grid: { display: false } }, y: { ticks: { callback: v => moneyShort(v), color: cssVar("--tick"), font: { size: 10 } }, grid: { color: cssVar("--grid") } } } } });
    }
  }
  function renderPaperPanel() {
    $("paperHost").innerHTML =
      "<div class='callout'>Executes the strategy's current target allocation on an <b>Alpaca paper</b> account via your own Cloudflare Worker (your keys stay in the worker, never in this page). See <code>paper-worker/README.md</code> to deploy it. Live trading runs on the <b>hosted site</b>; this in-app preview can't reach external services. <i>Optional:</i> a <code>paper-rebalance</code> GitHub Action can auto-rebalance on a schedule.</div>" +
      "<div class='ctl'><label>Worker URL</label><input id='paperUrl' placeholder='https://your-worker.workers.dev' style='width:230px'></div>" +
      "<div class='ctl'><label>Access token <span class='hint'>(optional)</span></label><input id='paperToken' placeholder='if set on the worker' style='width:230px'></div>" +
      "<div class='btn-row'><button class='btn' id='btnPaperConnect'>Save &amp; connect</button><button class='btn primary' id='btnPaperExec'>Rebalance paper account to current target</button></div>" +
      "<div class='nl-status' id='paperStatus'></div><div id='paperAccount' style='margin-top:10px'></div>";
    $("paperUrl").value = paperCfg.url || ""; $("paperToken").value = paperCfg.token || "";
    $("btnPaperConnect").onclick = () => { paperCfg.url = $("paperUrl").value.trim(); paperCfg.token = $("paperToken").value.trim(); savePaperCfg(); paperConnect(); };
    $("btnPaperExec").onclick = paperExecute;
  }

  function init() {
    $("dataBadge").innerHTML = `${META.start} &rarr; ${META.end} &middot; ${META.n.toLocaleString()} days &middot; ${META.source}`;
    $("envNote").innerHTML = (window.cowork && window.cowork.askClaude) ? "AI plain-English editing: ON" : "AI editing off — using built-in parser";
    $("foot").innerHTML = `Anchors before their launch are calibrated proxies. Leveraged-ETF prices include fund expense ratios. Taxes are modeled (average-cost basis, yearly payment, no wash-sale rule) — an approximation, not tax advice. ADX = Average Directional Index (whipsaw); the ADX <i>anchor</i> is the Adams Diversified Equity Fund. Educational tool, not investment advice.`;
    restore(); let _theme = false; try { _theme = localStorage.getItem("lrs_theme") === "dark"; } catch (e) {} applyTheme(_theme); buildControls(); updateSummary(); renderAlerts(); loadPaperCfg(); renderPaperPanel();
    $("themeToggle").onclick = () => applyTheme(!document.body.classList.contains("dark"));
    $("btnRun").onclick = run;
    $("btnSave").onclick = saveVersion;
    $("btnUpdate").onclick = updateVersion;
    if (editingVersionId && versions.find(v => v.id === editingVersionId)) { $("btnUpdate").style.display = ""; $("btnUpdate").textContent = "Update version"; }
    $("btnReset").onclick = () => { params = structuredClone(DEFAULTS); prevAnchor = params.anchorKey; editingVersionId = null; $("btnUpdate").style.display = "none"; buildControls(); updateSummary(); persist(); run(); };
    $("btnNl").onclick = applyNL;
    $("nlInput").addEventListener("keydown", e => { if (e.key === "Enter") applyNL(); });
    $("btnExportCfg").onclick = exportConfig;
    $("btnExportVers").onclick = exportVersions;
    $("btnImportVers").onclick = () => $("importVersFile").click();
    $("importVersFile").addEventListener("change", importFile);
    $("btnExportMd").onclick = exportMarkdown;
    $("btnPdf").onclick = savePDF;
    $("logScale").addEventListener("change", () => renderChart(currentChartType));
    document.querySelectorAll("#chartTabs .tab").forEach(t => t.onclick = () => renderChart(t.dataset.chart));
    run();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
