# Telegram Visit Tracking Bot (Node.js / grammy)

This repo contains a Telegram bot (TypeScript, grammy) to register visits of field reps to shops using QR codes, photo proof, geolocation and timestamps. It uses MongoDB (mongoose) to store users, shops, and visits. Reports can be exported to Excel.

## Features implemented

- Registration: `/start` asks the user to send their employee ID or full name and binds it to their Telegram account.
- Visit flow: scan shop QR → opens `/visit SHOP123` → bot asks for photo → then asks for geolocation → visit saved with shop code/name, photo file_id, geo, timestamp.
- Admin report: `/report day|week|YYYY-MM-DD` — generates an Excel file with visits and sends it to admin.

## Environment

Create a `.env` file with these variables:

```
BOT_TOKEN=your_bot_token
MONGODB_URI=mongodb://localhost:27017/yourdb
ADMIN_IDS=123456789    # comma-separated Telegram IDs that can run /report
EMPLOYEE_IDS=         # optional comma-separated employee Telegram IDs used for all-submitted checks
TARGET_LAT=0          # optional target lat for distance checks
TARGET_LNG=0          # optional target lng for distance checks
```

## Install & run

```bash
npm install
npm run dev
```

The dev script uses `nodemon` and `tsx` (already in package.json) to run `src/index.ts`.

## Seeding shops

You can add shops to the `shops` collection. A small seeder is provided:

```bash
# set MONGODB_URI and run
node scripts/seed_shops.js
```

Edit `scripts/seed_shops.js` to change or add shop codes.

## Notes

- Photos are stored on Telegram servers; the bot stores `file_id` and the `file_path` (cached when saving). The generated Excel includes a `PhotoUrl` column allowing direct download via Telegram API.
- For QR codes, generate QR images encoding the text `/visit SHOP123` (so scanner opens the bot with that command). Any QR generator can do this.

## Next steps (ideas)

- Add an admin web panel
- Store/serve photos in cloud storage
- Add verification to ensure photo is not forwarded
