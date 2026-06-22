// Cross-implementation parity: backtest engine (src/engine.js) vs live signal (alerts/check_signal.py).
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const E = require(path.join(__dirname, "../src/engine.js"));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/strategy_data.json"), "utf8"));
let fails = 0; const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fails++; };
const close = (a, b, t) => Math.abs(a - b) <= (t || 1e-9) * Math.max(1, Math.abs(b));
const base = { enginePct:70, anchorKey:"jepq", smaWindow:50, volWindow:20, volThresh:60, rsiWindow:14, rsiOverheat:75, rsiOversold:30, wTrend:0.4, wVol:0.3, wRsiHot:0.3, wRsiCold:-0.3, vixThresh:40, lookup:[{h:0,f:0},{h:0.3,f:0.2143},{h:0.4,f:0.4},{h:0.7,f:0.7143},{h:1,f:1}], vetoRsiOversold:true, safetySwitch:true, whipsaw:false, whipsawDetector:"both", adxWindow:14, adxThresh:20, erWindow:10, erThresh:0.30 };
const C = (name, iv, ov) => ({ name, iv, ov: ov || {} });
const I = (price,sma,rsi,vol,vix,adx,er) => ({price,sma,rsi,vol,vix,adx,er});
const cases = [
  C("bull neutral h=0", I(110,100,50,30,15,30,0.5)),
  C("trend on (price<sma)", I(90,100,50,30,15,30,0.5)),
  C("vol on (vol>thresh)", I(110,100,50,80,15,30,0.5)),
  C("rsi hot (>overheat)", I(110,100,80,30,15,30,0.5)),
  C("rsi cold + trend, no veto", I(90,100,20,30,15,30,0.5), {vetoRsiOversold:false}),
  C("rsi cold veto -> h=0", I(90,100,20,30,15,30,0.5), {vetoRsiOversold:true}),
  C("full crash h=1", I(90,100,80,80,15,30,0.5)),
  C("vix safety SQQQ->TLT", I(90,100,80,80,50,30,0.5)),
  C("whipsaw both active", I(110,100,50,30,15,10,0.1), {whipsaw:true,whipsawDetector:"both"}),
  C("whipsaw both inactive (one low)", I(110,100,50,30,15,10,0.5), {whipsaw:true,whipsawDetector:"both"}),
  C("whipsaw either active", I(110,100,50,30,15,10,0.5), {whipsaw:true,whipsawDetector:"either"}),
  C("whipsaw adx-only", I(110,100,50,30,15,10,0.5), {whipsaw:true,whipsawDetector:"adx"}),
  C("whipsaw er-only", I(110,100,50,30,15,30,0.1), {whipsaw:true,whipsawDetector:"er"}),
  C("whipsaw beats vix-safety", I(90,100,80,80,50,10,0.1), {whipsaw:true,whipsawDetector:"both"}),
  C("enginePct 100", I(110,100,50,30,15,30,0.5), {enginePct:100}),
  C("enginePct 0 (all anchor)", I(110,100,50,30,15,30,0.5), {enginePct:0}),
];
const jsTarget = c => { const p = Object.assign({}, base, c.ov); const ind = {sma:[c.iv.sma],rsi:[c.iv.rsi],vol:[c.iv.vol],adx:[c.iv.adx],er:[c.iv.er]}; const data = {tqqq:[c.iv.price],vix:[c.iv.vix]}; const t = E.targetWeights(0, ind, data, p); return {tqqq:t.tqqq,sqqq:t.sqqq,jepq:t.jepq,tlt:t.tlt}; };
const N = Math.min(DATA.tqqq.length, 1500);
const px = DATA.tqqq.slice(-N), hi = DATA.tqqq_high.slice(-N), lo = DATA.tqqq_low.slice(-N), cl = DATA.tqqq_close.slice(-N);
const ip = { smaWindow:50, rsiWindow:14, volWindow:20, adxWindow:14, erWindow:10 };
const ind = E.computeIndicators(px, ip.smaWindow, ip.rsiWindow, ip.volWindow);
const jsAdx = E.computeADX(hi, lo, cl, ip.adxWindow), jsEr = E.computeER(px, ip.erWindow);
fs.writeFileSync("/tmp/parity_in.json", JSON.stringify({ base, cases, series:{px,hi,lo,cl}, ip }));
try { execFileSync("python3", [path.join(__dirname, "parity_py.py"), "/tmp/parity_in.json", "/tmp/parity_out.json"]); } catch (e) { if (e.code === "ENOENT") { console.log("SKIP parity: python3 not found on this runner"); process.exit(0); } throw e; }
const py = JSON.parse(fs.readFileSync("/tmp/parity_out.json", "utf8"));
cases.forEach((c, i) => { const j = jsTarget(c), q = py.targets[i]; const m = ["tqqq","sqqq","jepq","tlt"].every(k => close(j[k], q[k])); ok("target: " + c.name, m); if (!m) console.log("   JS " + JSON.stringify(j) + "  PY " + JSON.stringify(q)); });
const cmp = (name, a, b) => { let bad = 0, n = 0, worst = 0; for (let i = 0; i < a.length; i++) { if (a[i] == null || b[i] == null) continue; n++; const d = Math.abs(a[i] - b[i]); if (d > worst) worst = d; if (!close(a[i], b[i], 1e-6)) bad++; } ok("indicator " + name + " (" + n + " pts, worst delta " + worst.toExponential(1) + ")", bad === 0); };
cmp("SMA", ind.sma, py.sma); cmp("RSI", ind.rsi, py.rsi); cmp("vol", ind.vol, py.vol); cmp("ADX", jsAdx, py.adx); cmp("ER", jsEr, py.er);
console.log("\n" + (fails ? fails + " PARITY FAILURES" : "ALL PARITY TESTS PASSED"));
process.exit(fails ? 1 : 0);
