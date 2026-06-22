import json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "alerts"))
import check_signal as cs
inp = json.load(open(sys.argv[1]))
base, cases, s, ip = inp["base"], inp["cases"], inp["series"], inp["ip"]
targets = []
for c in cases:
    p = dict(base); p.update(c["ov"]); v = c["iv"]
    tw = cs.target(v["price"], v["sma"], v["rsi"], v["vol"], v["vix"], v["adx"], v["er"], p)
    targets.append({"tqqq": tw["tqqq"], "sqqq": tw["sqqq"], "jepq": tw["jepq"], "tlt": tw["tlt"]})
sma, rsi, vol = cs.indicators(s["px"], ip["smaWindow"], ip["rsiWindow"], ip["volWindow"])
adx = cs.compute_adx(s["hi"], s["lo"], s["cl"], ip["adxWindow"])
er = cs.compute_er(s["px"], ip["erWindow"])
json.dump({"targets": targets, "sma": sma, "rsi": rsi, "vol": vol, "adx": adx, "er": er}, open(sys.argv[2], "w"))
