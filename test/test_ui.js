const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
let html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8")
  .replace(/<script src="https:\/\/cdn[^>]*><\/script>/g, "");
const errs = [];
class StubChart { constructor() { StubChart.n++; } destroy() {} update() {} }
StubChart.n = 0;
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://test.local/", beforeParse(w) {
  w.Chart = StubChart; w.structuredClone = global.structuredClone; w.requestAnimationFrame = cb => setTimeout(cb, 0);
  w.HTMLCanvasElement.prototype.getContext = () => ({}); w.prompt = () => "vTest"; w.confirm = () => true; w.URL.createObjectURL = () => "blob:test"; w.URL.revokeObjectURL = () => {};
  w.addEventListener("error", e => errs.push(e.error && e.error.stack || e.message));
} });
const doc = dom.window.document; let fails = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fails++; };
const txt = id => (doc.getElementById(id) || {}).innerHTML || "";
const val = id => { const e = doc.getElementById(id); return e ? e.value : undefined; };
setTimeout(() => {
  ok("Engine present", !!dom.window.Engine);
  ok("no JS errors on load", errs.length === 0);
  ok("summary populated", txt("summary").length > 150);
  ok("KPIs rendered", (txt("kpis").match(/kpi/g) || []).length >= 8);
  ok("comparison table rows", (txt("cmpTable").match(/<tr/g) || []).length >= 18);
  ok("signal panel rendered", txt("sigState").length > 0 && txt("sigAlloc").includes("width"));
  ok("anchor dropdown present", doc.getElementById("c_anchorKey") !== null);
  ok("whipsaw controls present", doc.getElementById("c_whipsaw") !== null && doc.getElementById("c_adxThresh") !== null);
  ok("whipsaw default OFF", doc.getElementById("c_whipsaw").checked === false);
  ok("rebalance has signal option", !!doc.querySelector('#c_rebalance option[value="signal"]'));
  ok("executeTiming control present", !!doc.getElementById("c_executeTiming"));
  ok("tax controls present", doc.getElementById("c_accountType") && doc.getElementById("c_stRate") && doc.getElementById("c_ltRate"));
  ok("default account = taxable", val("c_accountType") === "taxable");
  ok("KPIs show after-tax label", txt("kpis").toLowerCase().includes("after-tax"));
  ok("tax note visible (taxable)", doc.getElementById("taxNote").style.display !== "none" && txt("taxNote").toLowerCase().includes("after-tax"));
  ok("Pretax CAGR row present", txt("cmpTable").includes("Pretax CAGR"));
  ok("compare selector rendered", txt("compareSel").includes("QQQ") && txt("compareSel").includes("TQQQ"));
  ok("md/pdf export buttons present", !!doc.getElementById("btnExportMd") && !!doc.getElementById("btnPdf"));
  ok("theme toggle present", !!doc.getElementById("themeToggle"));
  ok("paper trading panel present", !!doc.getElementById("btnPaperConnect") && !!doc.getElementById("btnPaperExec"));
  doc.getElementById("themeToggle").click();
  ok("dark mode applied on toggle", doc.body.classList.contains("dark"));
  doc.getElementById("themeToggle").click();
  ok("toggles back to light", !doc.body.classList.contains("dark"));
  let mdThrew=false; try { doc.getElementById("btnExportMd").click(); } catch(e){ mdThrew=true; errs.push(e.stack); }
  ok("export .md no-throw", !mdThrew);
  ok("signal shows ADX & ER", txt("sigBreak").includes("ADX") && txt("sigBreak").includes("ER "));
  ok("chart instantiated", StubChart.n >= 1);

  // natural-language parser
  doc.getElementById("nlInput").value = "switch anchor to schd, turn on whipsaw, adx threshold 25";
  doc.getElementById("btnNl").click();
  setTimeout(() => {
    ok("NL anchor=schd", val("c_anchorKey") === "schd");
    ok("NL whipsaw on", doc.getElementById("c_whipsaw").checked === true);
    ok("NL adxThresh=25", +val("c_adxThresh") === 25);
    doc.getElementById("nlInput").value = "adx threshold 33";
    doc.getElementById("btnNl").click();
    setTimeout(() => {
      ok("bare 'adx threshold' keeps anchor=schd", val("c_anchorKey") === "schd");
      ok("NL adxThresh=33", +val("c_adxThresh") === 33);
      // save + load version
      doc.getElementById("btnSave").click();
      setTimeout(() => {
        ok("version saved (chip)", txt("versionChips").includes("vTest"));
        ok("update button shown", doc.getElementById("btnUpdate").style.display !== "none");
        // toggle to tax-advantaged
        const acc = doc.getElementById("c_accountType"); acc.value = "taxAdvantaged"; acc.dispatchEvent(new dom.window.Event("change"));
        setTimeout(() => {
          ok("tax note hidden (tax-advantaged)", doc.getElementById("taxNote").style.display === "none");
          let threw = false;
          try { ["drawdown", "alloc", "annual", "equity"].forEach(t => doc.querySelector('#chartTabs .tab[data-chart="' + t + '"]').click()); }
          catch (e) { threw = true; errs.push(e.stack); }
          ok("chart tab switching no-throw", !threw);
          ok("still no JS errors", errs.length === 0);
          if (errs.length) console.log("\n--- errors ---\n" + errs.slice(0, 4).join("\n\n"));
          console.log("\n" + (fails ? fails + " FAILURES" : "ALL UI TESTS PASSED"));
          process.exit(fails ? 1 : 0);
        }, 50);
      }, 50);
    }, 50);
  }, 50);
}, 250);
