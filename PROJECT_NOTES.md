# Leveraged Rotation Strategy — Project Notes & Runbook

_Last updated: 2026-06-23._

## What this is
An interactive dashboard plus automation for a leveraged-ETF swing strategy: a 70% "engine"
(TQQQ/SQQQ rotation driven by a hedge score) + 30% anchor sleeve (JEPQ by default; swappable to
JEPI/QYLD/SCHD/BIL/ADX). It backtests on dividend-adjusted data (2010–2026), computes risk/return
metrics, charts vs benchmarks (QQQ, TQQQ) and saved versions, sends live email/Telegram alerts,
and trades on Alpaca **paper** money.

## Links
- Repo (public): https://github.com/csreenath-rgb/TQQQSwingTrader
- Dashboard (GitHub Pages): https://csreenath-rgb.github.io/TQQQSwingTrader/
- Cloudflare Worker (paper proxy + config store): https://tqqq-paper-trader.csreenath-rgb.workers.dev

## Components
- `src/engine.js` — pure backtest engine (indicators, hedge score, target weights, metrics).
- `src/ui.js`, `src/template.html` — dashboard. `build.js` assembles `index.html` + `public/index.html`
  from `src/*` + `data/strategy_data.json`.
- `alerts/check_signal.py` — live signal checker (mirrors engine.js). Emails/Telegrams on allocation change.
- `alerts/paper_rebalance.py` — scheduled auto-rebalance; computes the active strategy target and POSTs to the Worker.
- `paper-worker/worker.js` + `rebalance.mjs` — Cloudflare Worker: proxies Alpaca paper API, stores
  dashboard config in KV, plans/executes rebalances (with band + idempotent stale-order cancel), `/orders` history.
- `.github/workflows/` — `ci.yml` (build+test+deploy Pages, gated on tests), `alerts.yml` (Fri signal check),
  `paper-rebalance.yml` (Fri auto-rebalance).
- `test/` — `test_engine.js`, `test_ui.js`, `test_paper.mjs`, `test_parity.js` (+ `parity_py.py`). All run by `npm test`.

## Where each secret / config lives (the recurring source of confusion)
- **Alpaca paper API keys** → Cloudflare Worker secrets `ALPACA_KEY` / `ALPACA_SECRET` (`wrangler secret put`). Never in the dashboard or repo.
- **Alpaca endpoint** → `paper-worker/wrangler.toml` → `ALPACA_BASE = https://paper-api.alpaca.markets`. Set once.
- **Worker access token** → Worker secret `ACCESS_TOKEN` (gate). The dashboard sends the same value; the Actions send it as `PAPER_ACCESS_TOKEN`. Do **not** commit the token value to this public repo — it lives only as the Worker secret, the GitHub `PAPER_ACCESS_TOKEN` secret, and your dashboard field.
- **Dashboard-driven config** → Cloudflare KV (binding `CONFIG`): the selected alert strategies + the active paper strategy. One-time: `wrangler kv namespace create CONFIG` → paste id into `wrangler.toml` → `wrangler deploy`.
- **GitHub repo secrets** (Settings → Secrets and variables → Actions): `PAPER_WORKER_URL`, `PAPER_ACCESS_TOKEN`, `SMTP_USER`, `SMTP_PASS` (Gmail App Password — not the account password), `ALERT_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. (`SMTP_HOST`/`SMTP_PORT` optional; default smtp.gmail.com:587 — the code tolerates empty values.)
- **Dashboard "Default on open"** → browser localStorage only; never touches automation.

## Strategy logic (engine.js ≡ check_signal.py, parity-tested)
- Hedge score `h = clip( (price<SMA ? wTrend) + (vol>volThresh ? wVol) + (RSI>overheat ? wRsiHot : RSI<oversold ? wRsiCold), 0, 1)`.
- Oversold veto: if `vetoRsiOversold` and RSI<oversold → h=0.
- Split: `enginePct` → engine vs anchor (1−enginePct). SQQQ fraction = interpolated lookup of h.
  TQQQ = engine·(1−sFrac), SQQQ = engine·sFrac, anchor = 1−engine.
- VIX safety: if `safetySwitch` and VIX>vixThresh → SQQQ sleeve → TLT.
- Whipsaw filter: if `whipsaw` and (ADX<adxThresh and/or ER<erThresh, per `whipsawDetector`) → whole engine → TLT.
- Rebalance modes: weekly / monthly / daily / **signal**. Signal mode trades only when total weight
  drift > `rebalanceBand`%. **This band is now honored live too** (was a backtest-only bug).
- Tax model (after-tax view, taxable account): the **strategy** realizes short/long-term gains on each
  rebalance (mostly short-term when rebalancing weekly). The **TQQQ / QQQ buy-&-hold baselines** are one lot,
  shown as the after-tax *liquidation value at every point* — short-term while held <1yr, long-term after
  (`engine.js: buyHoldAfterTax(eq, dates, p)`). Final value / CAGR unchanged; "Total taxes paid" = the single
  terminal sale. Display/metrics only — no live-trading impact.

## Backtest ↔ live parity guarantee
Two implementations are kept identical: `engine.js` (backtest) and `check_signal.py` (live).
`test/test_parity.js` (in `npm test` and CI) drives BOTH with identical inputs — 16 target-logic cases
(every trigger) plus all 5 indicators over ~1,500 real bars — and fails on any divergence
(worst observed delta 1.4e-14). Run: `npm test` or `npm run test:parity` (needs python3; skips cleanly if absent).

## Deploy runbook
1. `npm test` → expect ALL ENGINE / UI / PAPER / PARITY TESTS PASSED.
2. Worker (after any `paper-worker/*` change): `cd paper-worker && wrangler deploy`.
   One-time KV: `wrangler kv namespace create CONFIG` → put the id in `wrangler.toml` → deploy.
3. Dashboard + scripts + workflows: `git add -A && git commit -m "..." && git pull --rebase origin main && git push`.
   CI re-tests and republishes Pages. (`alerts.yml` commits `alerts/state.json` each run, so pushes
   usually need `git pull --rebase` first — non-fast-forward.)

## Operations (no commits needed once deployed)
- **Switch alert strategies:** dashboard → Live rebalance alerts → tick strategies (auto-saves to the Worker). Each alerts by name.
- **Switch active paper strategy:** dashboard → Paper trading → "Active strategy" dropdown (auto-saves to the Worker; drives the manual button and the scheduled rebalance).
- **Manual paper rebalance:** Paper panel → Rebalance button (honors the band).
- **Trade history:** Paper panel → Trade history button (Worker `/orders`, last 50).
- **Default fallback** (if the Worker has no config): `alerts/strategy_config.json` (settable via dashboard "Export default config" + commit; optional).

## Notifications (Gmail SMTP via GitHub Actions; scheduled-only by design)
- Scheduled auto-rebalance → email + Telegram with trade details, only when orders are actually placed.
- Alert-settings change → "settings changed" email at the next scheduled alert run (signature compared in `state.json`).
- Live signal change → email/Telegram on allocation change.
- NOT built: instant emails for the manual button / instant config change (would require the Worker to send via an email API such as Resend). Deferred per choice.

## Pending / optional follow-ups
- Instant (Worker-sent) emails for the manual rebalance + config changes (needs Resend or similar).
- Multi-account paper rebalancing (one Alpaca account per strategy).

## Environment note (Claude sessions only)
Claude's in-session Linux sandbox intermittently truncates files on read, so in-sandbox `node`/`npm test`
can spuriously fail. The user's real disk (C:\) is authoritative; reliable build/test/deploy happens on the
user's machine. This does not affect the deployed system. Reliable in-sandbox writes use bash heredocs;
verify via the Read tool or git HEAD.
