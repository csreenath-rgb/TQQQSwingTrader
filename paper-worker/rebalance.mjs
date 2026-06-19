// Pure rebalance planner: given account equity, current positions ($ market value
// by symbol) and target weights, return the close/buy/sell actions to reach target.
export function planRebalance(equity, positions, targets, minTrade = 1) {
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
  return { closes: [...new Set(closes)], orders };
}
