#!/usr/bin/env python3
"""
Append fresh Yahoo Finance bars to data/strategy_data.json so the static dashboard always shows
current data. The historical (proxy-spliced) portion is kept intact; only real recent bars are
appended (all funds exist now, so no proxy is needed). New bars are scaled to the existing
dividend-adjustment basis at the last common date so returns stay continuous. Stdlib only.
Run daily after close via .github/workflows/refresh-data.yml.
"""
import os, sys, json, time, urllib.request
import datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("DATA_FILE") or os.path.join(HERE, "..", "data", "strategy_data.json")

def yahoo(ticker, ohlc=False, days=160):
    now = int(time.time())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           f"?period1={now-days*86400}&period2={now}&interval=1d&events=div")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        j = json.load(r)
    res = j["chart"]["result"][0]; ts = res["timestamp"]; q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    def m(a): return {dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"): a[i]
                      for i, t in enumerate(ts) if i < len(a) and a[i] is not None}
    out = {"adj": m(adj)}
    if ohlc: out["high"] = m(q["high"]); out["low"] = m(q["low"]); out["close"] = m(q["close"])
    return out

def main():
    d = json.load(open(DATA)); last = d["dates"][-1]
    T = yahoo("TQQQ", ohlc=True); V = yahoo("^VIX")
    SQ = yahoo("SQQQ"); TL = yahoo("TLT"); QQ = yahoo("QQQ")
    anc = {"jepq": "JEPQ", "jepi": "JEPI", "qyld": "QYLD", "schd": "SCHD", "bil": "BIL", "adx": "ADX"}
    ANC = {k: yahoo(t)["adj"] for k, t in anc.items()}
    new = sorted(x for x in T["adj"] if x > last and x in V["adj"] and x in T["high"])
    if not new:
        print("No new bars since", last, "- nothing to do."); return
    def push(arr, src):
        ref = src.get(last); base = arr[-1]
        r = (base / ref) if (ref not in (None, 0)) else 1.0   # rescale to existing adj basis
        for x in new:
            v = src.get(x)
            arr.append(round(float((v * r) if v is not None else arr[-1]), 4))
    push(d["tqqq"], T["adj"]); push(d["tqqq_high"], T["high"]); push(d["tqqq_low"], T["low"]); push(d["tqqq_close"], T["close"])
    push(d["sqqq"], SQ["adj"]); push(d["tlt"], TL["adj"]); push(d["qqq"], QQ["adj"]); push(d["vix"], V["adj"])
    for k in anc: push(d["anchors"][k], ANC[k])
    push(d["jepq"], ANC["jepq"])  # top-level jepq mirrors anchors.jepq
    d["dates"].extend(new)
    d["meta"]["end"] = d["dates"][-1]; d["meta"]["n"] = len(d["dates"]); d["meta"]["fetched"] = dt.date.today().isoformat()
    L = len(d["dates"])
    for k in ("tqqq", "sqqq", "jepq", "tlt", "qqq", "vix", "tqqq_high", "tqqq_low", "tqqq_close"):
        assert len(d[k]) == L, (k, len(d[k]), L)
    for k in d["anchors"]:
        assert len(d["anchors"][k]) == L, ("anchor " + k, len(d["anchors"][k]), L)
    json.dump(d, open(DATA, "w"), separators=(",", ":"))
    print(f"Appended {len(new)} bar(s): {new[0]}..{new[-1]}; n={L}; end={d['meta']['end']}")

if __name__ == "__main__":
    main()
