# DRAGON Marketplace 🐉

## Upload
Upload `worker.js`, `schema.sql`, `wrangler.toml`, and this README to your GitHub repository.

## Cloudflare configuration
1. Create a D1 database named `dragon-marketplace-db`.
2. Run `schema.sql` in the D1 console.
3. Replace the placeholder database_id in wrangler.toml.
4. Bind D1 to the Worker as `DB`.
5. Add secrets: `BOT_TOKEN`, `WEBHOOK_SECRET`, `SETUP_PASSWORD`.
6. Add Worker variables: `ADMIN_IDS` (your Telegram numeric ID or comma-separated IDs), `BOT_USERNAME` (without @).
7. Deploy, then visit `/setup` and enter the setup password.
8. Add the bot as administrator of @DRAGONMarketplace.
9. Test /start, join check, menu, balance, history.
10. Remove `/setup` code and the SETUP_PASSWORD secret after webhook registration is confirmed.

## Important
This is a feature-rich bot core and database foundation, not a finished real-money production marketplace. Blockchain transaction verification, real ad callbacks, partner bot/Mini App callbacks, campaign payment/reservation workflow, screenshot fraud review, membership re-check scheduler, and fully audited admin mutations must be integrated and tested before live use. The bot deliberately never credits deposits from an unverified TXID. Never enter wallet seed phrases or private keys into the bot.
