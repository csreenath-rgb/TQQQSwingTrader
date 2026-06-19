const fs = require("fs");
const path = require("path");
const E = require(path.join(__dirname, "../src/engine.js"));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/strategy_data.json"), "utf8"));
const base = {
  initialCapital: 100000, startDate: DATA.dates[0], endDate: DATA.dates[DATA.dates.length - 1],
  enginePct: 70, smaWindow: 50, volWindow: 20, volThresh: 60,
  rsiWindow: 14, rsiOverheat: 75, rsiOversold: 30,
  wTrend: 0.4, wVol: 0.3, wRsiHot: 0.3, wRsiCold: -0.3, vixThresh: 40,
  lookup: [{h:0,f:0},{h:0.3,f:0.2143},{h:0.4,f:0.4},{h:0.7,f:0.7143},{h:1,f:1}],
  vetoRsiOversold: true, safetySwitch: true, jepqRouteIncome: true,
  anchorKey: "jepq", anchorYield: 9.98,
  whipsaw: false, whipsawDetector: "both", adxWindow: 14, adxThresh: 20, erWindow: 10, erThresh: 0.30,
  rebalance: "weekly", executeTiming: "nextOpen", rebalanceBand: 5, signalLagDays: 1,
  accountType: "taxAdvantaged", stRate: 35, ltRate: 15, incomeRate: 35,
  tradingCostBps: 5, extraMgmtFeePct: 0, riskFreePct: 4.3
};
const pct = x => (x*100).toFixed(2)+"%";
const relerr = (a,b)=>Math.abs(a-b)/Math.max(1e-9,Math.abs(b));
let fails=0; const ok=(n,c)=>{console.log((c?"PASS ":"FAIL ")+n); if(!c)fails++;};

let p={...base, enginePct:100, tradingCostBps:0, jepqRouteIncome:false, lookup:[{h:0,f:0},{h:1,f:0}]};
let bt=E.runBacktest(DATA,p);
let bh=E.buyHold(DATA.tqqq,DATA.dates,bt.dates,base.initialCapital);
ok("100%TQQQ == TQQQ B&H", relerr(bt.equity.at(-1),bh.at(-1))<1e-9);

p={...base, enginePct:0, tradingCostBps:0, jepqRouteIncome:false};
bt=E.runBacktest(DATA,p);
bh=E.buyHold(DATA.anchors.jepq,DATA.dates,bt.dates,base.initialCapital);
ok("100%JEPQ == JEPQ B&H", relerr(bt.equity.at(-1),bh.at(-1))<1e-9);

bt=E.runBacktest(DATA,base);
const m=E.metrics(bt.equity,bt.dates,E.seriesReturns(E.buyHold(DATA.qqq,DATA.dates,bt.dates,1e5)),base);
const r=[];for(let i=1;i<bt.equity.length;i++)r.push(bt.equity[i]/bt.equity[i-1]-1);
const mu=r.reduce((s,x)=>s+x,0)/r.length, sd=Math.sqrt(r.reduce((s,x)=>s+(x-mu)**2,0)/r.length);
let pk=bt.equity[0],mdd=0;for(const v of bt.equity){if(v>pk)pk=v;mdd=Math.min(mdd,v/pk-1);}
ok("vol & maxDD recompute", relerr(m.volA,sd*Math.sqrt(252))<1e-9 && relerr(m.maxDD,mdd)<1e-9);
let wbad=0;for(const w of bt.wHist) if(Math.abs(w.tqqq+w.sqqq+w.jepq+w.tlt-1)>1e-9)wbad++;
ok("weights sum to 1", wbad===0);

// tax: taxAdvantaged -> after-tax == pretax
ok("taxAdvantaged: equityAT == equity", relerr(bt.equityAT.at(-1),bt.equity.at(-1))<1e-9 && bt.tax.total===0);

// tax: taxable -> after-tax < pretax, taxes>0, mostly short-term (weekly)
const tx=E.runBacktest(DATA,{...base,accountType:"taxable"});
const preF=tx.equity.at(-1), atF=tx.tax.afterTaxFinal;
ok("taxable: after-tax < pretax & taxes>0", atF<preF && tx.tax.total>0);
ok("taxable: gains mostly short-term (weekly)", tx.tax.pctShortTerm>0.8);
console.log(`     taxable strat: pretax $${Math.round(preF).toLocaleString()} -> after-tax $${Math.round(atF).toLocaleString()} (${pct(atF/preF-1)} hit); ST%=${pct(tx.tax.pctShortTerm)}; total tax $${Math.round(tx.tax.total).toLocaleString()}`);

// buy&hold after-tax: single terminal LT haircut
const tqbh=E.buyHold(DATA.tqqq,DATA.dates,bt.dates,1e5);
const tqAT=E.buyHoldAfterTax(tqbh,{...base,accountType:"taxable"});
ok("B&H after-tax only haircuts the end", relerr(tqAT.at(0),tqbh.at(0))<1e-12 && tqAT.at(-1)<tqbh.at(-1));

// signal mode: fewer rebalances than daily; 100%TQQQ signal == B&H
const dailyN=E.runBacktest(DATA,{...base,rebalance:"daily"}).stats.rebalCount;
const sigRun=E.runBacktest(DATA,{...base,rebalance:"signal",rebalanceBand:5});
ok("signal mode trades less than daily", sigRun.stats.rebalCount<dailyN);
const sigTQ=E.runBacktest(DATA,{...base,enginePct:100,tradingCostBps:0,jepqRouteIncome:false,lookup:[{h:0,f:0},{h:1,f:0}],rebalance:"signal"});
ok("100%TQQQ signal mode == B&H", relerr(sigTQ.equity.at(-1),bh.at(-1)===undefined?E.buyHold(DATA.tqqq,DATA.dates,sigTQ.dates,1e5).at(-1):E.buyHold(DATA.tqqq,DATA.dates,sigTQ.dates,1e5).at(-1))<1e-9);

// sameClose timing: 100%TQQQ still == B&H
const scTQ=E.runBacktest(DATA,{...base,enginePct:100,tradingCostBps:0,jepqRouteIncome:false,lookup:[{h:0,f:0},{h:1,f:0}],executeTiming:"sameClose"});
ok("100%TQQQ sameClose == B&H", relerr(scTQ.equity.at(-1),E.buyHold(DATA.tqqq,DATA.dates,scTQ.dates,1e5).at(-1))<1e-9);

console.log("\n"+(fails?fails+" FAILURES":"ALL ENGINE TESTS PASSED"));
process.exit(fails?1:0);
