# MultiGram

A PWA (installable web app) that connects **multiple Telegram accounts** and lets you read their chats in one place. All credentials live in **Vercel environment variables** — nothing is stored in the app or a database.

**Privacy guard:** the official Telegram service chats (`777000` and `42777`) — where login codes arrive — are **hidden server-side**. Nobody using this app can read login codes through it.

## How it works

- Built with Next.js + [GramJS](https://gram.js.org/) (Telegram MTProto client).
- Each account is represented by a **session string** stored in an env var.
- Optional app-wide password (`APP_PASSWORD`) protects access.

## Chat features

- **Media display** — photos, videos, GIFs and stickers render inline; voice notes get an inline player with a scrub bar (`/api/media` proxies the download, authenticated).
- **AI voice notes (text-to-speech)** — type your message, tap the mic to turn it into an ElevenLabs AI voice, preview it, then send it as a real Telegram voice message (round bubble). The generated MP3 is converted to OGG/Opus server-side with a bundled `ffmpeg` binary. Supports v3 audio tags like `[giggles]` or `[whispers]`.
- **Clickable links** — URLs in messages render as clickable links. The link button (🔗) sends a **bold** labelled clickable link (e.g. the word "Tap here" linking to a URL) using Telegram HTML formatting, with the link preview card suppressed.
- **Reply** — reply to any message; the quoted message is shown above your reply.
- **Forward** — forward any message to one or more chats on the same account. The picker lets you search by name or nickname, select targets (highlighted), and press Forward.
- **Live updates** — the open chat and the chat list refresh every second, updating in place without flicker or scroll jumps.
- **Group topics** — forum groups show their topic list when opened; pick a topic to read and post within that thread.
- **Nicknames** — give any chat a custom nickname (pencil icon in the chat header). Nicknames are stored locally on your device and shown in the list, header and forward picker.
- **Clean inbox** — archived chats and chats with blocked users are hidden from the list. Videos show a tappable thumbnail and stream the full clip only when you play them.

> These are interactive features, so the app can now **send** into chats. The official Telegram service chats (login codes) remain hidden server-side and can't be opened or sent to.

**All Telegram credentials always come from Vercel environment variables** — nothing is hard-coded or stored in the app.

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
| `ELEVENLABS_API_KEY` | your ElevenLabs API key (for AI voice notes) |
| `ELEVENLABS_VOICE_ID` | the ElevenLabs Voice ID to speak with |
| `ELEVENLABS_MODEL_ID` | optional — TTS model, defaults to `eleven_v3` |

The `ELEVENLABS_*` variables are only needed if you want the AI voice-note feature. Get the API key from your [ElevenLabs account](https://elevenlabs.io/) and copy a Voice ID from the Voices page (or the Voice Library).

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
- Always set `APP_PASSWORD` — without it, anyone with the URL can read AND send from your chats.
- The Telegram service chats (login codes) are filtered in the API layer (`lib/telegram.js`), not just in the UI, so they can't be fetched even by calling the API directly.
- The app can send messages, voice notes, links and forwards. Automating a personal Telegram account is against Telegram's ToS and can get an account limited — keep the volume low.
