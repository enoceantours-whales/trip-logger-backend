# Enocean Tours — Trip Logger

Trip logging app for Enocean Tours. Logs wildlife sightings, captures group photos, and emails a PDF trip report to guests via Mailchimp.

---

## Stack

- **Frontend** — Vanilla HTML/CSS/JS (no framework needed)
- **Backend** — Vercel Serverless Functions (Node.js)
- **Email + CRM** — Mailchimp

---

## Project Structure

```
trip-logger-backend/
├── api/
│   └── send-report.js     # Serverless function — PDF generation + Mailchimp
├── public/
│   └── index.html         # Frontend app
├── .env.example           # Environment variable template
├── vercel.json            # Vercel routing config
└── package.json
```

---

## Deployment

### 1. Clone the repo

```bash
git clone https://github.com/enoceantours-whales/trip-logger-backend.git
cd trip-logger-backend
```

### 2. Install dependencies locally (for testing)

```bash
npm install
```

### 3. Set environment variables in Vercel

Go to your Vercel project → Settings → Environment Variables and add:

| Key | Value |
|-----|-------|
| `MAILCHIMP_API_KEY` | Your Mailchimp API key |
| `MAILCHIMP_AUDIENCE_ID` | `9a668398f5` |
| `MAILCHIMP_SERVER_PREFIX` | The prefix from your API key (e.g. `us1`, `us14`) |
| `FROM_EMAIL` | `info@enoceantours.com` |
| `FROM_NAME` | `Enocean Tours` |

> **Finding your server prefix:** Your Mailchimp API key ends with `-us14` or similar. That `us14` part is your server prefix.

### 4. Deploy to Vercel

Connect your GitHub repo to Vercel (it auto-deploys on every push).

Or manually:

```bash
npx vercel --prod
```

---

## Environment Variables

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

Never commit `.env` to GitHub. It's in `.gitignore`.

---

## How It Works

1. Captain starts trip on phone
2. Logs each sighting (species, count, time, GPS coordinates auto-captured)
3. At trip end, uploads group photo and enters guest email
4. App calls `/api/send-report` with trip data
5. Serverless function generates a PDF and sends it to the guest via Mailchimp
6. Guest is added to the Enocean Tours Mailchimp audience with tag `Trip Guest`
7. Repeat guests get tagged `Repeat Guest` automatically

---

## Local Development

```bash
npm install -g vercel
vercel dev
```

This runs the full stack locally at `http://localhost:3000`.
