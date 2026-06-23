#!/usr/bin/env python3
"""
Optional scheduled auto-rebalance: compute the strategy's current target allocation
(reusing the exact signal logic in check_signal.py) and POST it to your Alpaca paper
Worker's /rebalance endpoint. No-op (just prints targets) if PAPER_WORKER_URL is unset.

Env: PAPER_WORKER_URL  (your Cloudflare Worker URL)
     PAPER_ACCESS_TOKEN (the worker's ACCESS_TOKEN, if set)
"""
import os, sys, json, urllib.request, urllib.error, urllib.parse
import datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_signal as cs

def notify_rebalance(pname, asof, summary, res):
    results = res.get("results", [])
    if not results:
        print("[email] no orders placed - no rebalance email"); return
    lines = []
    for x in results:
        amt = ("$" + format(int(x["notional"]), ",")) if x.get("notional") is not None else ""
        act = x.get("action") or x.get("side") or ""
        stt = "ok" if x.get("ok") else ("FAILED: " + str(x.get("error", "")))
        lines.append("  " + str(x.get("symbol", "")) + " " + act + " " + amt + " - " + stt)
    ok_n = sum(1 for x in results if x.get("ok")); bad_n = len(results) - ok_n
    subject = "[Paper] Rebalance executed - " + pname + " (" + summary + ")"
    head = ["PAPER REBALANCE EXECUTED", "Strategy : " + pname, "As of    : " + str(asof),
            "Equity   : $" + format(int(res.get("equity", 0)), ",")]
    if res.get("canceled"): head.append("Cancelled " + str(res["canceled"]) + " stale order(s) first.")
    head += ["Target   : " + summary, "", "Orders (" + str(ok_n) + " ok, " + str(bad_n) + " failed):"]
    body = chr(10).join(head + lines + ["", "Alpaca paper account. Educational tool, not investment advice."])
    cs.send_telegram(body); cs.send_email(subject, body)

def main():
    wc = cs.fetch_worker_config()
    act = wc.get("activeStrategy") or {}
    if (act.get("params") or {}).get("enginePct") is not None:
        p = dict(act["params"]); p.setdefault("name", act.get("name", "Active")); print("[config] active strategy from Worker:", p["name"])
    else:
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
    pname = p.get("name", "Default"); anchor = p.get("anchorKey", "jepq").upper()
    targets = [{"symbol": s, "weight": round(w, 4)} for s, w in
               [("TQQQ", tw["tqqq"]), ("SQQQ", tw["sqqq"]), ("TLT", tw["tlt"]), (anchor, tw["jepq"])] if w > 0.001]
    summary = ", ".join(f"{t['symbol']} {round(t['weight']*100)}%" for t in targets)
    _rb = p.get("rebalanceBand"); band = ((float(_rb) if _rb is not None else 5) / 100) if p.get("rebalance") == "signal" else 0
    print(f"[{p.get('name','Default')}] As of {dates[i]}: {tw['state']} (score {tw['h']:.2f}) -> {summary}")
    # Cadence gate (mirrors engine.js maybeRebalance): only act on the days the backtest would.
    mode = p.get("rebalance", "weekly")
    if mode in ("weekly", "monthly") and len(dates) >= 2:
        gd = lambda s: (dt.date.fromisoformat(s).weekday() + 1) % 7  # JS getDay: Sun=0..Sat=6
        if mode == "weekly" and not (gd(dates[i]) < gd(dates[i - 1])):
            print(f"[cadence] weekly mode: {dates[i]} is not a new-week boundary - no rebalance today."); return
        if mode == "monthly" and dt.date.fromisoformat(dates[i]).month == dt.date.fromisoformat(dates[i - 1]).month:
            print(f"[cadence] monthly mode: {dates[i]} is the same month as the prior bar - no rebalance today."); return
    url = os.environ.get("PAPER_WORKER_URL"); tok = os.environ.get("PAPER_ACCESS_TOKEN")
    if not url:
        print("PAPER_WORKER_URL not set - computed targets only, no orders placed."); return
    print(f"Worker host: {urllib.parse.urlparse(url).netloc} | access token present: {bool(tok)} (length {len(tok or '')})")
    headers = {"content-type": "application/json", "Accept": "application/json",
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"}
    if tok: headers["x-access-token"] = tok
    req = urllib.request.Request(url.rstrip("/") + "/rebalance", data=json.dumps({"targets": targets, "band": band}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
        if res.get("skipped"):
            print(f"Within band: drift {res.get('drift')} <= band {res.get('band')} - no rebalance needed."); return
        if res.get("canceled"): print(f"Cancelled {res['canceled']} stale order(s) first.")
        print("Worker result:", json.dumps(res.get("results", res))[:1800])
        try: notify_rebalance(pname, dates[i], summary, res)
        except Exception as ne: print("[email] notify failed (rebalance already executed):", ne)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        print(f"Rebalance call failed: HTTP {e.code} {e.reason} | worker said: {body}")
        if e.code == 403:
            print("  403 = the worker rejected the token. PAPER_ACCESS_TOKEN must EXACTLY equal the worker's ACCESS_TOKEN (no trailing space/newline), and PAPER_WORKER_URL must point to that same worker.")
        sys.exit(1)
    except Exception as e:
        print("Rebalance call failed:", e); sys.exit(1)

if __name__ == "__main__":
    main()
