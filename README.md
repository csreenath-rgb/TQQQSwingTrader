# Leveraged Rotation Strategy — Backtest Dashboard & Live Alerts

An interactive dashboard that **simulates, backtests, and tunes** a leveraged-rotation
strategy — a TQQQ/SQQQ "engine" plus a **swappable income/anchor sleeve** — with a
**whipsaw filter** that steps aside into Treasuries during choppy markets. It benchmarks
against **QQQ** and **TQQQ** and fires **email + Telegram alerts** when a rebalance is due.

## What's in here

```
index.html                     The dashboard (self-contained; open it or host on Pages)
data/strategy_data.json        Dividend-adjusted daily prices 2010–2026 + TQQQ OHLC (Yahoo)
alerts/check_signal.py         Live signal checker + email/Telegram sender (stdlib only)
alerts/strategy_config.json    Strategy parameters — single source of truth for alerts
alerts/state.json              Last allocation (created & updated automatically)
.github/workflows/alerts.yml   Scheduled job that runs the checker and alerts on change
.github/workflows/deploy-pages.yml   Publishes the dashboard to GitHub Pages
```

## The dashboard

Open `index.html` in a browser, or enable **GitHub Pages** for a hosted URL. It lets you:

- **Simulate & backtest** on real 2010–2026 data.
- **Swap the 30% anchor** between **JEPQ, JEPI, QYLD, SCHD, BIL (cash), and ADX**
  (Adams Diversified Equity Fund). Short-history funds use a labeled pre-launch proxy.
- **Toggle the whipsaw filter** (see below) and tune its detector + thresholds.
- **Tune every parameter** with labeled controls, or **type plain-English edits**
  ("switch anchor to SCHD and turn off the whipsaw filter"). A live plain-English summary
  of the rules updates as you go.
- **Compute risk/reward metrics** — CAGR, volatility, Sharpe, Sortino, Calmar, max
  drawdown, beta/alpha vs QQQ, up/down capture, VaR/CVaR.
- **Chart** growth-of-$100k, drawdown, allocation-over-time, and annual returns vs **QQQ**,
  **TQQQ**, and any **saved versions** of your own strategy.
- **Compare in a table** — every metric side by side, best/worst highlighted.
- **See the current signal** — today's hedge score, ADX/ER readings, target allocation,
  and whether a rebalance is due.

## The whipsaw filter

Leveraged ETFs decay in choppy, trendless markets (the strategy's worst years are 2011 and
2015–16). The whipsaw filter detects chop and **parks the entire engine sleeve in TLT**
until a clean trend resumes. Two detectors (selectable, usable together):

- **ADX** (Average Directional Index) — trend strength; below the threshold (default 20) =
  no trend. *(Note: "ADX" here is the indicator. The "ADX" anchor option is a different
  thing — the Adams Diversified Equity Fund, ticker ADX.)*
- **Efficiency Ratio** (Kaufman) — net move ÷ total path over a window; below the threshold
  (default 0.30) = choppy.

Default detector is **"both"** (ADX *and* ER must agree), which triggers selectively. On
2010–2026 it lowered volatility from ~31% to ~28% and CAGR from ~24% to ~21%.

## Live rebalance alerts (email + Telegram)

The dashboard can't send messages from a browser sandbox, so alerts run on **GitHub
Actions**. `alerts/check_signal.py` reuses the exact signal logic (including ADX/whipsaw),
pulls fresh prices from Yahoo, and emails/Telegrams you **only when the target allocation
changes** from `alerts/state.json`.

### One-time setup

1. **Push this folder to a GitHub repo** (default branch `main`).
2. **Add repository secrets** — *Settings → Secrets and variables → Actions*:

   | Secret | What it is |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | Token from **@BotFather** |
   | `TELEGRAM_CHAT_ID` | Your chat id |
   | `SMTP_USER` | Sending Gmail address |
   | `SMTP_PASS` | Gmail **App Password** (16 chars, not your login password) |
   | `ALERT_TO` | Destination address (comma-separated for several) |
   | `SMTP_HOST` / `SMTP_PORT` | *(optional)* default `smtp.gmail.com` / `587` |

   Set only Telegram, only email, or both — each channel is skipped if its secrets are absent.
3. **Enable Actions**: repo → *Actions* → enable workflows.
4. **(Optional) Enable Pages**: *Settings → Pages → Source: GitHub Actions*.

### Get a Telegram bot token + chat id

- Message **@BotFather** → `/newbot` → copy the **token**.
- Message your new bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates`
  and copy the `chat.id`.

### Get a Gmail App Password

- Enable 2-Step Verification, then *Google Account → Security → App passwords* → create one
  for "Mail" and use the 16-character value as `SMTP_PASS`.

### Test it

*Actions → "Strategy rebalance alerts" → Run workflow*. To force a message regardless of
state, temporarily change the run line to `python alerts/check_signal.py --force`.

### When it runs

Default **Friday 15:45 ET** (two cron lines cover daylight-saving). For every weekday, use
`cron: "45 20 * * 1-5"`. The job commits `alerts/state.json` so it only messages on change.

## Keep dashboard and alerts in sync

Tune in the dashboard, click **"Export config for alerts"**, and replace
`alerts/strategy_config.json` with the download. Commit it.

## Data & proxies

Prices are **dividend-adjusted daily closes** from Yahoo Finance (total return). Leveraged-ETF
prices already include each fund's expense ratio, so the cost model charges only your trading
friction (turnover × bps). TQQQ raw high/low/close are included for the ADX calculation.

Anchor funds launched at different times (**JEPQ** 2022, **JEPI** 2020, **QYLD** 2013,
**SCHD** 2011; **BIL** and **ADX** predate 2010). Before a fund's launch its return is a
**calibrated proxy** (up/down-capture regression on QQQ or SPY; R² ≈ 0.75–0.93), and the
dashboard marks the proxy/real boundary on every chart.

## Disclaimer

Educational backtesting tool. Past and simulated performance does not predict future results.
Leveraged and inverse ETFs carry severe decay and loss risk. **Not investment advice.**
