#!/usr/bin/env python3
"""
Optional scheduled auto-rebalance: compute the strategy's current target allocation
(reusing the exact signal logic in check_signal.py) and POST it to your Alpaca paper
Worker's /rebalance endpoint. No-op (just prints targets) if PAPER_WORKER_URL is unset.

Env: PAPER_WORKER_URL  (your Cloudflare Worker URL)
     PAPER_ACCESS_TOKEN (the worker's ACCESS_TOKEN, if set)
"""
import os, sys, json, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_signal as cs

def main():
    p = json.load(open(os.path.join(HERE, "strategy_config.json")))
    T = cs.yahoo("TQQQ", ohlc=True); V = cs.yahoo("^VIX")
    dates = sorted(x for x in T["adj"] if x in V["adj"] and x in T["high"])
    tq = [T["adj"][x] for x in dates]; vx = [V["adj"][x] for x in dates]
    hi = [T["high"][x] for x in dates]; lo = [T["low"][x] for x in dates]; cl = [T["close"][x] for x in dates]
    sma, rsi, vol = cs.indicators(tq, int(p["smaWindow"]), int(p["rsiWindow"]), int(p["volWindow"]))
    adx = cs.compute_adx(hi, lo, cl, int(p.get("adxWindow", 14)))
    er = cs.compute_er(tq, int(p.get("erWindow", 10)))
    i = len(dates) - 1
    tw = cs.target(tq[i], sma[i], rsi[i], vol[i], vx[i], adx[i], er[i], p)
    anchor = p.get("anchorKey", "jepq").upper()
    targets = [{"symbol": s, "weight": round(w, 4)} for s, w in
               [("TQQQ", tw["tqqq"]), ("SQQQ", tw["sqqq"]), ("TLT", tw["tlt"]), (anchor, tw["jepq"])] if w > 0.001]
    summary = ", ".join(f"{t['symbol']} {round(t['weight']*100)}%" for t in targets)
    print(f"As of {dates[i]}: {tw['state']} (score {tw['h']:.2f}) -> {summary}")
    url = os.environ.get("PAPER_WORKER_URL"); tok = os.environ.get("PAPER_ACCESS_TOKEN")
    if not url:
        print("PAPER_WORKER_URL not set - computed targets only, no orders placed."); return
    headers = {"content-type": "application/json"}
    if tok: headers["x-access-token"] = tok
    req = urllib.request.Request(url.rstrip("/") + "/rebalance", data=json.dumps({"targets": targets}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
        print("Worker result:", json.dumps(res.get("results", res))[:1500])
    except Exception as e:
        print("Rebalance call failed:", e); sys.exit(1)

if __name__ == "__main__":
    main()
