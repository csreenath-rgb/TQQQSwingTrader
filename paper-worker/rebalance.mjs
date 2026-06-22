// Pure rebalance planner: given account equity, current positions ($ market value
// by symbol) and target weights, return the close/buy/sell actions to reach target.
// opts: { minTrade=1, band=0 }. If band>0 and total absolute weight drift <= band,
// the whole rebalance is skipped (matches the backtest "signal" mode band behavior).
export function planRebalance(equity, positions, targets, opts = {}) {
  if (typeof opts === "number") opts = { minTrade: opts };
  const minTrade = opts.minTrade != null ? opts.minTrade : 1;
  const band = opts.band != null ? opts.band : 0;
  if (band > 0 && equity > 0) {
    const tw = {}; targets.forEach(t => tw[t.symbol] = t.weight);
    const syms = new Set([...Object.keys(positions), ...targets.map(t => t.symbol)]);
    let drift = 0;
    for (const s of syms) drift += Math.abs((tw[s] || 0) - ((positions[s] || 0) / equity));
    if (drift <= band) return { closes: [], orders: [], skipped: true, drift: Math.round(drift * 1e4) / 1e4, band };
  }
  const tset = new Set(targets.map(t => t.symbol));
  const closes = [];
  for (const sym of Object.keys(positions)) if (!tset.has(sym) && positions[sym] > 0) closes.push(sym);
  const orders = [];
  for (const t of targets) {
    const cur = positions[t.symbol] || 0;
    const tgt = equity * t.weight;
    const delta = tgt - cur;
    if (delta > minTrade) orders.push({ symbol: t.symbol, side: "buy", notional: Math.round(delta * 100) / 100 });
    else if (delta < -minTrade) {
      if (cur > 0 && Math.abs(delta) >= cur - minTrade) closes.push(t.symbol);
      else orders.push({ symbol: t.symbol, side: "sell", notional: Math.round(-delta * 100) / 100 });
    }
  }
  return { closes: [...new Set(closes)], orders, skipped: false };
}
