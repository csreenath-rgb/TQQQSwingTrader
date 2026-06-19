import { planRebalance } from "./rebalance.mjs";
const cors = o => ({ "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,x-access-token", "Access-Control-Max-Age": "86400" });
const json = (obj, status, o) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json", ...cors(o) } });
async function alpaca(env, path, method = "GET", body) {
  const base = env.ALPACA_BASE || "https://paper-api.alpaca.markets";
  const r = await fetch(base + path, { method, headers: { "APCA-API-KEY-ID": env.ALPACA_KEY, "APCA-API-SECRET-KEY": env.ALPACA_SECRET, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (!r.ok) throw new Error((j && j.message) || ("Alpaca " + r.status));
  return j;
}
export default {
  async fetch(req, env) {
    const o = env.ALLOW_ORIGIN || "*";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });
    const url = new URL(req.url);
    if (env.ACCESS_TOKEN) { const t = req.headers.get("x-access-token") || url.searchParams.get("token"); if (t !== env.ACCESS_TOKEN) return json({ error: "unauthorized" }, 403, o); }
    try {
      if (url.pathname === "/health") return json({ ok: true }, 200, o);
      if (url.pathname === "/account") {
        const acct = await alpaca(env, "/v2/account");
        const positions = await alpaca(env, "/v2/positions");
        let history = null;
        try { const h = await alpaca(env, "/v2/account/portfolio/history?period=3M&timeframe=1D&extended_hours=false"); history = { timestamp: h.timestamp, equity: h.equity }; } catch (e) {}
        return json({ equity: +acct.equity, last_equity: +acct.last_equity, cash: +acct.cash, buying_power: +acct.buying_power, status: acct.status,
          positions: positions.map(p => ({ symbol: p.symbol, qty: +p.qty, market_value: +p.market_value, avg_entry: +p.avg_entry_price, price: +p.current_price, unrealized_pl: +p.unrealized_pl, unrealized_plpc: +p.unrealized_plpc })), history }, 200, o);
      }
      if (url.pathname === "/rebalance" && req.method === "POST") {
        const body = await req.json();
        const targets = (body.targets || []).filter(t => t.symbol && t.weight > 0.0005);
        if (!targets.length) return json({ error: "no targets" }, 400, o);
        const acct = await alpaca(env, "/v2/account");
        const positions = await alpaca(env, "/v2/positions");
        const posMap = {}; positions.forEach(p => posMap[p.symbol] = +p.market_value);
        const equity = +acct.equity;
        const plan = planRebalance(equity, posMap, targets);
        const results = [];
        for (const sym of plan.closes) { try { await alpaca(env, "/v2/positions/" + encodeURIComponent(sym), "DELETE"); results.push({ symbol: sym, action: "close", ok: true }); } catch (e) { results.push({ symbol: sym, action: "close", ok: false, error: e.message }); } }
        const place = async ord => { try { await alpaca(env, "/v2/orders", "POST", { symbol: ord.symbol, notional: ord.notional, side: ord.side, type: "market", time_in_force: "day" }); results.push({ ...ord, ok: true }); } catch (e) { results.push({ ...ord, ok: false, error: e.message }); } };
        for (const ord of plan.orders.filter(x => x.side === "sell")) await place(ord);
        for (const ord of plan.orders.filter(x => x.side === "buy")) await place(ord);
        return json({ ok: true, equity, plan, results }, 200, o);
      }
      return json({ error: "not found" }, 404, o);
    } catch (e) { return json({ error: e.message || String(e) }, 500, o); }
  }
};
