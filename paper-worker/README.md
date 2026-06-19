# Paper trading worker (Alpaca)

A tiny Cloudflare Worker that lets the dashboard rebalance an **Alpaca paper** account.
Your Alpaca keys live in the Worker as secrets — they are never in the web page.

## Deploy (one time)

1. Create a free **Alpaca** account → Paper Trading → **generate API keys** (key + secret).
2. Install Wrangler and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. From this folder, set the secrets and deploy:
   ```
   cd paper-worker
   wrangler secret put ALPACA_KEY        # paste your Alpaca paper key
   wrangler secret put ALPACA_SECRET     # paste your Alpaca paper secret
   wrangler secret put ACCESS_TOKEN      # any random string you choose
   wrangler deploy
   ```
4. Copy the deployed URL (e.g. `https://tqqq-paper-trader.<you>.workers.dev`).
5. In the dashboard's **Paper trading** card, paste that URL and the same `ACCESS_TOKEN`,
   click **Save & connect**, then **Rebalance** to deploy the current target allocation.

## Endpoints
- `GET /account` → equity, cash, positions, 3-month equity history
- `POST /rebalance` `{ "targets": [{ "symbol": "TQQQ", "weight": 0.55 }, ...] }` → places market orders to match
- `GET /health`

Market orders fill during market hours; outside hours Alpaca rejects them (the dashboard shows the error). Paper money only — not investment advice.


## Optional: scheduled auto-rebalance

Instead of (or in addition to) the dashboard button, the repo includes
`.github/workflows/paper-rebalance.yml`, which runs `alerts/paper_rebalance.py` on a schedule
(default Friday during US market hours) to rebalance the paper account automatically. To enable it,
add two repo secrets: `PAPER_WORKER_URL` (your Worker URL) and `PAPER_ACCESS_TOKEN` (the same token).
Change the `cron` in that workflow for a different cadence. Without the secrets it just prints the
computed target and places no orders.
