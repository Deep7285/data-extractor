# DataExtract — AI Invoice Data Extractor

A serverless web app that reads invoices — printed, scanned, or handwritten — and exports the structured data to Excel.
---

## What it does

Drop in a PDF, image (jpg/png), or Word document. The app sends it to an AI vision model, pulls out the relevant fields, and hands you back a formatted Excel file. The file never touches a database, it's read in memory and discarded the moment extraction is done.

It handles digital PDFs, scanned images, and handwritten bills — including ones in Hindi script, which was a real requirement from the client.

---

## Why it was built this way

The client had two hard constraints: no third-party file storage for compliance reasons, and the monthly cost had to stay near zero for a small team of users.

The solution was to process everything at the edge with Cloudflare Workers and never write files to disk. The frontend converts PDFs to images in the browser using pdf.js, compresses them, and posts them directly to the worker. The worker calls the AI model, gets back structured JSON, and returns it.

Cloudflare's free tier handles the worker and the KV store (used for user auth). GitHub Pages hosts the frontend. 
---

## Architecture

```
Browser (GitHub Pages)
   │
   │  POST /api/extract  (FormData: JPEG data URLs)
   ▼
Cloudflare Worker (KV: session store + user auth)
   │
   │  generateContent (vision model)
   ▼
Google Gemini Flash API
   │
   └─► JSON → back to browser → rendered as table → Excel download
```

The worker also handles login/logout. Sessions are stored in Cloudflare KV with a 30-day TTL. Passwords are hashed with PBKDF2-SHA256. Unauthenticated users get 2 free extraction sessions; after that, they're prompted to log in.

---

## Running locally

You need Node.js 18+ and a Cloudflare account.

```bash
git clone https://github.com/Deep7285/data-extractor.git
cd data-extractor

npm install

# Create your local environment file
cp .dev.vars.example .dev.vars
# Add your GEMINI_API_KEY inside .dev.vars

# Start the Cloudflare Worker locally
npx wrangler dev

# Open index.html directly in a browser (or use a local dev server)
```

The frontend is plain HTML/CSS/JS — no build step, no framework.

---

## Environment variables

These go in `.dev.vars` for local development, and as secrets in the Cloudflare dashboard for production. Do not commit this file.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key (get one free at aistudio.google.com) |

---

## Adding users

Users are stored directly in Cloudflare KV. To add one:

```bash
# 1. Generate a password hash using the make-user tool in /tools
node tools/make-user.mjs

# 2. Copy the output and store it in KV
wrangler kv:key put --binding=USERS user:deepak '{"username":"deepak",...}'
```

Passwords are never stored in plain text. The hash uses PBKDF2-SHA256 with a random salt and is verified in the worker on each login attempt.

---

## What's not in this repo

The Cloudflare Worker source (`src/`) is kept in a separate private repository. What's here is the frontend only. The backend handles all auth, API calls, and rate limiting — the frontend has no API keys and no secrets.

If you're a developer looking to understand the architecture or discuss implementation, feel free to reach out directly.

---

## Stack

- Vanilla HTML/CSS/JavaScript
- Cloudflare Workers (serverless edge backend)
- Cloudflare KV (user + session store)
- Google Gemini Flash (vision OCR)
- pdf.js (client-side PDF to image conversion)
- Mammoth.js (DOCX text extraction)
- SheetJS (Excel generation in the browser)
- Wrangler CLI (Cloudflare local dev + deploy)

---

## Contact

Built by Deepak Kumar  (Deep7285)