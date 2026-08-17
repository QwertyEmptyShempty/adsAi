# adsAi -- Facebook Ads automation core

Migrated from n8n. First piece: **auto-pause / auto-delete underperforming or disapproved ads**.

## Rules (see `src/config.ts`)
1. Hard kill: cost per landing_page_view >= $13 (no subscription) -> pause immediately.
2. Soft kill (after 3+ days AND $45+ spend): cost per LPV > $5 (no subscription) -> pause.
3. Soft kill (after grace): cost per subscription > $10 -> pause.
4. Auto-delete disapproved/error ads: currently **disabled** (`AUTO_DELETE_DISAPPROVED_ADS = false` in config.ts) per user request 17.08. Flip to `true` to re-enable.

## Environment variables (set in Render, never committed)
- `FB_ACCESS_TOKEN` -- Facebook Marketing API system user token
- `TELEGRAM_BOT_TOKEN` -- bot token for notifications (optional, logs-only if unset)

## Run locally
```
npm install
npm run dev:auto-pause
```

## Deploy (Render Cron Job)
- Build command: `npm install && npm run build`
- Cron command: `npm run auto-pause`
- Schedule: every hour (`0 * * * *`)

## Editing accounts
Edit `src/config.ts` directly and push -- Render auto-deploys on push to `main`.
