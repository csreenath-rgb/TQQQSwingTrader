# Onboarding & Usage — Start Here

Welcome. This is an interactive dashboard plus cloud automation for a leveraged-ETF swing
strategy: a 70% **engine** that rotates between **TQQQ** (3× Nasdaq-100) and **SQQQ** (-3×
inverse) by a 0–1 hedge score, plus a 30% **anchor** sleeve (JEPQ by default) for ballast.
You can backtest it, tune every parameter, compare strategies, and — optionally — run live
email/Telegram alerts and automatic **paper** trading on Alpaca.

> **Full step-by-step guide:** [`ONBOARDING_AND_USAGE_GUIDE.docx`](ONBOARDING_AND_USAGE_GUIDE.docx)
> — a printable walkthrough covering usage *and* the complete self-host setup, with a secrets
> map, an operations cheat sheet, and troubleshooting. This page is the quick front door.

## The three addresses

| What | Where |
|---|---|
| **Dashboard** (what you use) | https://csreenath-rgb.github.io/TQQQSwingTrader/ |
| **Code** (GitHub) | https://github.com/csreenath-rgb/TQQQSwingTrader |
| **Worker** (paper-trade proxy) | https://tqqq-paper-trader.csreenath-rgb.workers.dev |

You only need the first to explore the strategy.

## Just want to use it? (no setup)

1. Open the **dashboard** link above — nothing to install.
2. Adjust the **controls** on the left, or type plain English in the box (e.g. `engine 80%`,
   `anchor schd`, `signal-driven rebalance`, `tax-advantaged`).
3. Click **Run backtest** — the charts, KPI tiles, and comparison table refresh.
4. **Save** the current settings as a named version to compare strategies side by side;
   **Reset** returns to defaults.

The `.docx` explains what every control does and how to read each chart and metric.

## Want your own copy? (setup checklist)

Each step is independent — stop whenever you have enough.

1. **Run locally** — `git clone …` → `npm install` → `npm run build` → `npm test` → open
   `index.html`. Edit files in `src/`, never the generated `index.html`.
2. **Deploy the dashboard** — push to GitHub, then **Settings → Pages → Source: GitHub Actions**.
   CI tests then deploys; a failing test blocks the deploy and emails you.
3. **Email + Telegram alerts** — create a Telegram bot (`@BotFather`), generate a Gmail
   **App Password**, add the repo secrets, and test with **Actions → Strategy rebalance
   alerts → Run workflow**.
4. **Paper trading (Alpaca)** — create an Alpaca paper account, `wrangler deploy` the Cloudflare
   Worker with your keys as secrets, then paste the Worker URL + access token into the
   dashboard's **Paper trading** card and click **Save & connect → Rebalance**.
5. **Automation** — choose the alert strategies and the active paper strategy in the dashboard
   (both auto-save to the Worker), and add the `PAPER_WORKER_URL` + `PAPER_ACCESS_TOKEN` repo
   secrets to enable scheduled auto-rebalancing.

Full commands, the secrets-location map, the operations cheat sheet, and troubleshooting are in
[`ONBOARDING_AND_USAGE_GUIDE.docx`](ONBOARDING_AND_USAGE_GUIDE.docx).

## More documentation

- **[`README.md`](README.md)** — repository layout, local development, CI/CD, alert & paper-setup tables.
- **[`PROJECT_NOTES.md`](PROJECT_NOTES.md)** — maintainer runbook: architecture, secrets map, strategy
  logic, the backtest↔live parity guarantee, and the deploy runbook.
- **[`paper-worker/README.md`](paper-worker/README.md)** — the 5-minute Cloudflare Worker setup.

---

*Educational backtesting tool. Paper money only. Not investment advice. Leveraged and inverse
ETFs carry severe decay and loss risk.*
