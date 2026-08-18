# MultiGram

A PWA (installable web app) that connects **multiple Telegram accounts** and lets you read their chats in one place. All credentials live in **Vercel environment variables** — nothing is stored in the app or a database.

**Privacy guard:** the official Telegram service chats (`777000` and `42777`) — where login codes arrive — are **hidden server-side**. Nobody using this app can read login codes through it.

## How it works

- Built with Next.js + [GramJS](https://gram.js.org/) (Telegram MTProto client).
- Each account is represented by a **session string** stored in an env var.
- The app is read-only: it shows chats and messages, it cannot send anything.
- Optional app-wide password (`APP_PASSWORD`) protects access.

## Setup

### 1. Get Telegram API credentials

1. Go to [my.telegram.org](https://my.telegram.org) and log in.
2. Open **API development tools** and create an app.
3. Note the `api_id` and `api_hash`.

### 2. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

(or push the repo to GitHub and import it in the Vercel dashboard)

### 3. Set environment variables in Vercel

Project → **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `TELEGRAM_API_ID` | your `api_id` from my.telegram.org |
| `TELEGRAM_API_HASH` | your `api_hash` from my.telegram.org |
| `TELEGRAM_SESSIONS` | session strings, comma-separated (see step 4) |
| `APP_PASSWORD` | a password to lock the app (strongly recommended) |

### 4. Link your Telegram accounts

1. After the first deploy (with `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` and `APP_PASSWORD` set), open `https://your-app.vercel.app/setup`.
2. Enter the phone number of the account → Telegram sends a login code to that account's other devices (or SMS).
3. Enter the code (and the 2FA password if the account has one).
4. Copy the generated **session string**.
5. Paste it into `TELEGRAM_SESSIONS` in Vercel. For multiple accounts, separate with commas:

   ```text
   1BQANOTEuMTA4...,1BQANOTEuMTA4...,1BQANOTEuMTA4...
   ```

6. **Redeploy** the project (Deployments → ⋯ → Redeploy). The accounts appear as tabs at the top of the chat list.

### 5. Install as a PWA

- **Android/Chrome:** open the site → menu → "Add to Home screen".
- **iOS/Safari:** Share → "Add to Home Screen".
- **Desktop Chrome/Edge:** install icon in the address bar.

## Local development

```bash
npm install
# create .env.local with the same variables as above
npm run dev
```

## Security notes

- Session strings grant **full access** to the Telegram accounts. Treat them like passwords; only store them in Vercel env vars.
- Always set `APP_PASSWORD` — without it, anyone with the URL can read your chats.
- The Telegram service chats (login codes) are filtered in the API layer (`lib/telegram.js`), not just in the UI, so they can't be fetched even by calling the API directly.
