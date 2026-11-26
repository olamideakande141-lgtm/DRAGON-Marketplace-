
# DRAGON Marketplace 🐉

Telegram bot with a separate rewarded-ad Mini App.

## Features

- Telegram bot menu
- Mandatory official channel membership check
- User registration
- DRAGON balance foundation
- Referral link foundation
- Deposit address display
- Watch Ads Mini App
- Monetag rewarded-ad function integration
- Cloudflare Worker backend
- Cloudflare D1 database

## Required secrets

Set these in Cloudflare Worker settings:

BOT_TOKEN
WEBHOOK_SECRET
BOT_USERNAME
PUBLIC_BASE_URL
ADS_TEST_MODE
BTC_ADDRESS
USDT_TRC20_ADDRESS
USDT_BEP20_ADDRESS

ADS_TEST_MODE should be true during development.

## Database

Create a D1 database named dragon-marketplace.

Apply schema.sql to the database.

## Monetag

Paste the complete official Monetag publisher script into public/ads.html.

The show_12353542 function must be provided by that script.

## Telegram webhook

Register the Worker webhook using Telegram's setWebhook API.

Webhook URL:
https://YOUR-WORKER.workers.dev/telegram-webhook

Set the secret_token to the same value as WEBHOOK_SECRET.

## Important

Browser ad completion is not sufficient to authorize real DRAGON credits.

Connect and test Monetag's trusted server-side completion/postback before enabling spendable rewards.

Automatic deposit verification, campaign creation, campaign reservation, task verification, and partner integrations still require their provider-specific implementations.
