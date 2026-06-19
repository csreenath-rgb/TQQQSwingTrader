const fs = require("fs"), path = require("path");
const root = __dirname;
const rd = f => fs.readFileSync(path.join(root, f), "utf8");
const eng = rd("src/engine.js"), ui = rd("src/ui.js"), data = rd("data/strategy_data.json"), tpl = rd("src/template.html");
const html = tpl.replace("/*__ENGINE__*/", () => eng).replace("/*__DATA__*/", () => data).replace("/*__UI__*/", () => ui);
fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(path.join(root, "public/index.html"), html);
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("Built index.html (" + html.length + " bytes)");
