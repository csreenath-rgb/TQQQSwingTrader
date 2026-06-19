(function (root) {
  "use strict";
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const std = (a, ddof = 0) => {
    if (a.length - ddof <= 0) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - ddof));
  };
  const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const idx = clip(p, 0, 1) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function dow(ds) { return new Date(ds + "T00:00:00Z").getUTCDay(); }
  function yearOf(ds) { return +ds.slice(0, 4); }
  function monthOf(ds) { return ds.slice(0, 7); }

  function computeIndicators(prices, smaWindow, rsiWindow, volWindow) {
    const n = prices.length;
    const sma = new Array(n).fill(null), rsi = new Array(n).fill(null), vol = new Array(n).fill(null);
    let run = 0;
    for (let i = 0; i < n; i++) {
      run += prices[i];
      if (i >= smaWindow) run -= prices[i - smaWindow];
      if (i >= smaWindow - 1) sma[i] = run / smaWindow;
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < n; i++) {
      const ch = prices[i] - prices[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= rsiWindow) {
        avgGain += g; avgLoss += l;
        if (i === rsiWindow) { avgGain /= rsiWindow; avgLoss /= rsiWindow; rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); }
      } else {
        avgGain = (avgGain * (rsiWindow - 1) + g) / rsiWindow;
        avgLoss = (avgLoss * (rsiWindow - 1) + l) / rsiWindow;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    const ret = new Array(n).fill(0);
    for (let i = 1; i < n; i++) ret[i] = prices[i] / prices[i - 1] - 1;
    for (let i = volWindow; i < n; i++) vol[i] = std(ret.slice(i - volWindow + 1, i + 1)) * Math.sqrt(252) * 100;
    return { sma, rsi, vol };
  }

  function computeADX(high, low, close, period) {
    const n = (high && high.length) || 0;
    const adx = new Array(n).fill(null);
    if (!(high && low && close) || n < 2 * period + 1) return adx;
    const tr = new Array(n).fill(0), pDM = new Array(n).fill(0), mDM = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
      pDM[i] = (up > dn && up > 0) ? up : 0;
      mDM[i] = (dn > up && dn > 0) ? dn : 0;
      tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    }
    let atr = 0, pd = 0, md = 0;
    for (let i = 1; i <= period; i++) { atr += tr[i]; pd += pDM[i]; md += mDM[i]; }
    const dx = new Array(n).fill(null);
    const setDX = i => {
      const pDI = atr === 0 ? 0 : 100 * pd / atr, mDI = atr === 0 ? 0 : 100 * md / atr, s = pDI + mDI;
      dx[i] = s === 0 ? 0 : 100 * Math.abs(pDI - mDI) / s;
    };
    setDX(period);
    for (let i = period + 1; i < n; i++) {
      atr = atr - atr / period + tr[i]; pd = pd - pd / period + pDM[i]; md = md - md / period + mDM[i];
      setDX(i);
    }
    let s = 0; for (let i = period; i < 2 * period; i++) s += dx[i];
    adx[2 * period - 1] = s / period;
    for (let i = 2 * period; i < n; i++) adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
    return adx;
  }

  function computeER(prices, period) {
    const n = prices.length, er = new Array(n).fill(null);
    for (let i = period; i < n; i++) {
      const change = Math.abs(prices[i] - prices[i - period]);
      let v = 0; for (let k = i - period + 1; k <= i; k++) v += Math.abs(prices[k] - prices[k - 1]);
      er[i] = v === 0 ? 0 : change / v;
    }
    return er;
  }

  function lookupSqqqFrac(h, table) {
    const t = table.slice().sort((a, b) => a.h - b.h);
    if (h <= t[0].h) return t[0].f;
    if (h >= t[t.length - 1].h) return t[t.length - 1].f;
    for (let i = 1; i < t.length; i++) {
      if (h <= t[i].h) { const a = t[i - 1], b = t[i]; return a.f + (b.f - a.f) * (h - a.h) / (b.h - a.h); }
    }
    return t[t.length - 1].f;
  }

  function whipsawActive(adx, er, p) {
    if (!p.whipsaw) return false;
    const adxLow = adx != null && adx < p.adxThresh;
    const erLow = er != null && er < p.erThresh;
    switch (p.whipsawDetector) {
      case "adx": return adxLow;
      case "er": return erLow;
      case "either": return adxLow || erLow;
      case "both": return adxLow && erLow;
      default: return false;
    }
  }

  function targetWeights(s, ind, data, p) {
    const price = data.tqqq[s], sma = ind.sma[s], rsi = ind.rsi[s], vol = ind.vol[s], vix = data.vix[s];
    const adx = ind.adx ? ind.adx[s] : null, er = ind.er ? ind.er[s] : null;
    const trend = (sma != null && price < sma) ? p.wTrend : 0;
    const volt = (vol != null && vol > p.volThresh) ? p.wVol : 0;
    let rsiTerm = 0;
    if (rsi != null) { if (rsi > p.rsiOverheat) rsiTerm = p.wRsiHot; else if (rsi < p.rsiOversold) rsiTerm = p.wRsiCold; }
    let h = clip(trend + volt + rsiTerm, 0, 1);
    const vetoed = p.vetoRsiOversold && rsi != null && rsi < p.rsiOversold;
    if (vetoed) h = 0;
    const engine = p.enginePct / 100, anchor = 1 - engine;
    const sFrac = lookupSqqqFrac(h, p.lookup);
    let wT = engine * (1 - sFrac), wS = engine * sFrac, wJ = anchor, wTLT = 0;
    const whip = whipsawActive(adx, er, p);
    let safety = false;
    if (whip) { wTLT = engine; wT = 0; wS = 0; }
    else { safety = p.safetySwitch && vix != null && vix > p.vixThresh; if (safety) { wTLT = wS; wS = 0; } }
    return { tqqq: wT, sqqq: wS, jepq: wJ, tlt: wTLT, anchorW: wJ, h, rsi, vol, vix, adx, er, price, sma, vetoed, safety, whip, sFrac };
  }

  function weeklyBoundary(i, dates) { return dow(dates[i]) < dow(dates[i - 1]); }
  function anchorSeriesFor(data, key) {
    if (data.anchors && data.anchors[key]) return data.anchors[key];
    return data.jepq || (data.anchors && data.anchors.jepq);
  }

  function runBacktest(data, p) {
    const N = data.dates.length;
    const ind = computeIndicators(data.tqqq, p.smaWindow, p.rsiWindow, p.volWindow);
    ind.adx = computeADX(data.tqqq_high, data.tqqq_low, data.tqqq_close, p.adxWindow || 14);
    ind.er = computeER(data.tqqq, p.erWindow || 10);
    const anchorSeries = anchorSeriesFor(data, p.anchorKey || "jepq");
    const anchorYield = (p.anchorYield != null ? p.anchorYield : p.jepqYield) || 0;
    const lag = (p.executeTiming === "sameClose") ? 0 : (p.signalLagDays != null ? p.signalLagDays : 1);
    const sameClose = (p.executeTiming === "sameClose");
    const band = (p.rebalance === "signal") ? ((p.rebalanceBand != null ? p.rebalanceBand : 5) / 100) : 0;
    const taxOn = (p.accountType === "taxable");
    const stRate = (p.stRate != null ? p.stRate : 35) / 100;
    const ltRate = (p.ltRate != null ? p.ltRate : 15) / 100;
    const incRate = (p.incomeRate != null ? p.incomeRate : 35) / 100;

    let i0 = 0, i1 = N - 1;
    if (p.startDate) while (i0 < N && data.dates[i0] < p.startDate) i0++;
    if (p.endDate) { i1 = N - 1; while (i1 > 0 && data.dates[i1] > p.endDate) i1--; }
    const warm = Math.max(p.smaWindow, p.rsiWindow, p.volWindow, 2 * (p.adxWindow || 14), p.erWindow || 10) + 1;
    i0 = Math.max(i0, warm, lag + 1);
    if (i0 >= i1) return { error: "Not enough data in the selected window." };

    const dailyFee = p.extraMgmtFeePct / 100 / 252;
    const dailyYield = anchorYield / 100 / 252;
    const bps = p.tradingCostBps / 10000;

    const dates = [], equity = [], wHist = [], hHist = [], rebalEvents = [];
    let rebalCount = 0, turnoverSum = 0, costSum = 0;
    let sqqqExpSum = 0, tltExpSum = 0, hedgedDays = 0, vetoDays = 0, safetyDays = 0, whipDays = 0;

    const ASSETS = ["tqqq", "sqqq", "jepq", "tlt"];
    const basis = { tqqq: 0, sqqq: 0, jepq: 0, tlt: 0 }, age = { tqqq: 0, sqqq: 0, jepq: 0, tlt: 0 };
    let yrST = 0, yrLT = 0, yrInc = 0, stCarry = 0, ltCarry = 0, totTax = 0, totST = 0, totLT = 0, totInc = 0;
    const yearTax = {}, yearEndV = {};

    let V = p.initialCapital;
    let tw = targetWeights(Math.max(0, i0 - lag), ind, data, p);
    let hold = { tqqq: V * tw.tqqq, sqqq: V * tw.sqqq, jepq: V * tw.jepq, tlt: V * tw.tlt };
    for (const a of ASSETS) { basis[a] = hold[a]; age[a] = 0; }
    let ptr = i0;

    function record() {
      dates.push(data.dates[ptr]); equity.push(V);
      const wv = { tqqq: hold.tqqq / V, sqqq: hold.sqqq / V, jepq: hold.jepq / V, tlt: hold.tlt / V };
      wHist.push(wv); sqqqExpSum += wv.sqqq; tltExpSum += wv.tlt;
      if (wv.sqqq > 0.001 || wv.tlt > 0.001) hedgedDays++;
    }
    function buyAsset(a, amt) { const nv = hold[a] + amt; age[a] = nv > 1e-12 ? (hold[a] * age[a]) / nv : 0; basis[a] += amt; hold[a] = nv; }
    function sellAsset(a, amt) {
      if (hold[a] <= 1e-12) { hold[a] = 0; return; }
      const f = Math.min(1, amt / hold[a]); const sb = basis[a] * f; const gain = amt - sb;
      if (age[a] < 365) yrST += gain; else yrLT += gain;
      basis[a] -= sb; hold[a] -= amt; if (hold[a] < 1e-9) hold[a] = 0;
    }
    function rebalanceTo(t, di) {
      const cw = { tqqq: hold.tqqq / V, sqqq: hold.sqqq / V, jepq: hold.jepq / V, tlt: hold.tlt / V };
      const turnover = Math.abs(t.tqqq - cw.tqqq) + Math.abs(t.sqqq - cw.sqqq) + Math.abs(t.jepq - cw.jepq) + Math.abs(t.tlt - cw.tlt);
      const cost = V * turnover * bps; V -= cost; turnoverSum += turnover; costSum += cost; rebalCount++;
      for (const a of ASSETS) { const target = V * t[a]; const d = target - hold[a]; if (d > 0) buyAsset(a, d); else if (d < 0) sellAsset(a, -d); }
      tw = t; rebalEvents.push({ date: data.dates[di], ...t }); hHist.push({ date: data.dates[di], h: t.h });
      if (t.vetoed) vetoDays++; if (t.safety) safetyDays++; if (t.whip) whipDays++;
    }
    function maybeRebalance(i, sigIdx) {
      const periodic = (p.rebalance === "daily") ||
        (p.rebalance === "weekly" && weeklyBoundary(i, data.dates)) ||
        (p.rebalance === "monthly" && monthOf(data.dates[i]) !== monthOf(data.dates[i - 1]));
      const signalMode = (p.rebalance === "signal");
      if (!periodic && !signalMode) return;
      const t = targetWeights(Math.max(0, sigIdx), ind, data, p);
      const cw = { tqqq: hold.tqqq / V, sqqq: hold.sqqq / V, jepq: hold.jepq / V, tlt: hold.tlt / V };
      const drift = Math.abs(t.tqqq - cw.tqqq) + Math.abs(t.sqqq - cw.sqqq) + Math.abs(t.jepq - cw.jepq) + Math.abs(t.tlt - cw.tlt);
      if (signalMode && drift <= band) return;
      rebalanceTo(t, i);
    }
    function grow(i) {
      hold.tqqq *= data.tqqq[i] / data.tqqq[i - 1];
      hold.sqqq *= data.sqqq[i] / data.sqqq[i - 1];
      hold.tlt  *= data.tlt[i]  / data.tlt[i - 1];
      for (const a of ASSETS) age[a] += 1;
      const totR = anchorSeries[i] / anchorSeries[i - 1] - 1;
      if (p.jepqRouteIncome) {
        const priceR = totR - dailyYield; hold.jepq *= (1 + priceR);
        const income = dailyYield * hold.jepq; yrInc += income; buyAsset("tqqq", income);
      } else {
        const pre = hold.jepq; hold.jepq *= (1 + totR);
        const income = dailyYield * pre; yrInc += income; basis.jepq += income;
      }
      if (dailyFee > 0) { hold.tqqq *= (1 - dailyFee); hold.sqqq *= (1 - dailyFee); hold.jepq *= (1 - dailyFee); hold.tlt *= (1 - dailyFee); }
      V = hold.tqqq + hold.sqqq + hold.jepq + hold.tlt;
    }
    function finalizeYear(y) {
      const stNet = yrST + stCarry, ltNet = yrLT + ltCarry; let stTax = 0, ltTax = 0;
      if (stNet < 0) stCarry = stNet; else { stTax = stNet * stRate; stCarry = 0; }
      if (ltNet < 0) ltCarry = ltNet; else { ltTax = ltNet * ltRate; ltCarry = 0; }
      const incTax = Math.max(0, yrInc) * incRate;
      const tax = taxOn ? (stTax + ltTax + incTax) : 0;
      yearTax[y] = (yearTax[y] || 0) + tax; yearEndV[y] = V;
      totTax += tax; totST += Math.max(0, yrST); totLT += Math.max(0, yrLT); totInc += Math.max(0, yrInc);
      yrST = 0; yrLT = 0; yrInc = 0;
    }

    record();
    rebalEvents.push({ date: data.dates[i0], ...tw }); hHist.push({ date: data.dates[i0], h: tw.h });
    if (tw.vetoed) vetoDays++; if (tw.safety) safetyDays++; if (tw.whip) whipDays++;

    for (let i = i0 + 1; i <= i1; i++) {
      if (sameClose) { grow(i); maybeRebalance(i, i); }
      else { maybeRebalance(i, i - 1); grow(i); }
      const y = yearOf(data.dates[i]);
      const nextY = (i + 1 <= i1) ? yearOf(data.dates[i + 1]) : null;
      if (nextY !== null && nextY !== y) finalizeYear(y);
      ptr = i; record();
    }
    finalizeYear(yearOf(data.dates[i1]));

    // after-tax equity (taxes deducted as a fraction at each year-end)
    const effRate = {};
    for (const y in yearTax) effRate[y] = yearEndV[y] > 0 ? yearTax[y] / yearEndV[y] : 0;
    const equityAT = [equity[0]]; let vat = equity[0];
    for (let k = 1; k < equity.length; k++) {
      vat *= equity[k] / equity[k - 1];
      const y = yearOf(dates[k]); const yn = (k + 1 < dates.length) ? yearOf(dates[k + 1]) : null;
      if ((yn !== null && yn !== y) || k === equity.length - 1) vat *= (1 - (effRate[y] || 0));
      equityAT.push(vat);
    }

    const days = dates.length;
    return {
      dates, equity, equityAT, wHist, hHist, rebalEvents, ind, i0, i1, anchorKey: p.anchorKey || "jepq",
      tax: { on: taxOn, total: totTax, stGains: totST, ltGains: totLT, income: totInc,
             afterTaxFinal: equityAT[equityAT.length - 1], pctShortTerm: (totST + totLT) > 0 ? totST / (totST + totLT) : 0 },
      stats: { rebalCount, turnoverSum, costSum, avgSqqq: sqqqExpSum / days, avgTlt: tltExpSum / days,
               pctHedged: hedgedDays / days, vetoDays, safetyDays, whipDays }
    };
  }

  function buyHold(series, dates, refDates, initial) {
    const start = refDates[0], end = refDates[refDates.length - 1];
    const out = [];
    let i = dates.indexOf(start);
    const j = dates.indexOf(end);
    const base = series[i];
    for (; i <= j; i++) out.push(initial * series[i] / base);
    return out;
  }
  // after-tax buy&hold: defer all gains to one terminal long-term sale
  function buyHoldAfterTax(eq, p) {
    if (p.accountType !== "taxable") return eq.slice();
    const ltRate = (p.ltRate != null ? p.ltRate : 15) / 100;
    const out = eq.slice();
    const gain = eq[eq.length - 1] - eq[0];
    if (gain > 0) out[out.length - 1] = eq[eq.length - 1] - gain * ltRate;
    return out;
  }

  function metrics(equity, dates, benchRet, p) {
    const n = equity.length;
    const r = new Array(n - 1);
    for (let i = 1; i < n; i++) r[i - 1] = equity[i] / equity[i - 1] - 1;
    const d0 = new Date(dates[0] + "T00:00:00Z"), d1 = new Date(dates[n - 1] + "T00:00:00Z");
    const years = (d1 - d0) / (365.25 * 24 * 3600 * 1000);
    const totalReturn = equity[n - 1] / equity[0] - 1;
    const cagr = Math.pow(equity[n - 1] / equity[0], 1 / years) - 1;
    const rfDaily = p.riskFreePct / 100 / 252;
    const volA = std(r) * Math.sqrt(252);
    const mR = mean(r);
    const sharpe = std(r) === 0 ? 0 : (mR - rfDaily) / std(r) * Math.sqrt(252);
    const downs = Math.sqrt(mean(r.map(x => { const d = Math.min(x - rfDaily, 0); return d * d; })));
    const sortino = downs === 0 ? 0 : (mR - rfDaily) / downs * Math.sqrt(252);
    let peak = equity[0], maxDD = 0, worstEnd = 0;
    for (let i = 0; i < n; i++) { if (equity[i] > peak) peak = equity[i]; const dd = equity[i] / peak - 1; if (dd < maxDD) { maxDD = dd; worstEnd = i; } }
    const calmar = maxDD === 0 ? 0 : cagr / Math.abs(maxDD);
    const sorted = r.slice().sort((a, b) => a - b);
    const var95 = percentile(sorted, 0.05);
    const cvar95 = mean(sorted.filter(x => x <= var95));
    const posDays = r.filter(x => x > 0).length / r.length;
    let beta = NaN, alpha = NaN, corr = NaN, upCap = NaN, dnCap = NaN;
    if (benchRet && benchRet.length === r.length) {
      const mb = mean(benchRet);
      const cov = mean(r.map((x, i) => (x - mR) * (benchRet[i] - mb)));
      const vb = mean(benchRet.map(x => (x - mb) * (x - mb)));
      beta = vb === 0 ? 0 : cov / vb;
      alpha = ((mR - rfDaily) - beta * (mb - rfDaily)) * 252;
      corr = (std(r) * std(benchRet)) === 0 ? 0 : cov / (std(r) * std(benchRet));
      const up = [], upb = [], dn = [], dnb = [];
      benchRet.forEach((b, i) => { if (b > 0) { up.push(r[i]); upb.push(b); } else if (b < 0) { dn.push(r[i]); dnb.push(b); } });
      upCap = upb.length ? (mean(up) / mean(upb)) * 100 : NaN;
      dnCap = dnb.length ? (mean(dn) / mean(dnb)) * 100 : NaN;
    }
    const yrs = {};
    let prevYear = yearOf(dates[0]), startVal = equity[0];
    for (let i = 1; i < n; i++) {
      const y = yearOf(dates[i]);
      if (y !== prevYear) { yrs[prevYear] = equity[i - 1] / startVal - 1; startVal = equity[i - 1]; prevYear = y; }
    }
    yrs[prevYear] = equity[n - 1] / startVal - 1;
    const yearVals = Object.values(yrs);
    return {
      finalValue: equity[n - 1], totalReturn, cagr, volA, sharpe, sortino, maxDD, calmar,
      var95, cvar95, posDays, beta, alpha, corr, upCap, dnCap,
      bestDay: Math.max(...r), worstDay: Math.min(...r), bestYear: Math.max(...yearVals), worstYear: Math.min(...yearVals),
      years, nDays: n, yearReturns: yrs, ddRecoveryDate: dates[worstEnd]
    };
  }

  function drawdownSeries(equity) {
    let peak = equity[0]; const dd = [];
    for (let i = 0; i < equity.length; i++) { if (equity[i] > peak) peak = equity[i]; dd.push(equity[i] / peak - 1); }
    return dd;
  }
  function seriesReturns(equity) { const r = []; for (let i = 1; i < equity.length; i++) r.push(equity[i] / equity[i - 1] - 1); return r; }

  const API = { mean, std, clip, percentile, dow, computeIndicators, computeADX, computeER,
    lookupSqqqFrac, whipsawActive, targetWeights, anchorSeriesFor, runBacktest, buyHold, buyHoldAfterTax, metrics, drawdownSeries, seriesReturns };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Engine = API;
})(typeof window !== "undefined" ? window : globalThis);
