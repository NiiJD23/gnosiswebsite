# Gnosis website

The product website for [Gnosis](https://github.com/NiiJD23/gnosisv2), a private, local-first personal AI assistant.

Live at https://gnosis.promintal.com

## What is here

- `public/`: the website (index, product, download, about, demo, contact, privacy), `site.css`, `site.js`, `assets/`, and the private dashboard `admin.html`
- `src/worker.js`: a small Cloudflare Worker that serves `public/` and records visits to a D1 database
- `wrangler.jsonc`: Worker, assets and database settings

The demo and contact forms post to `/api/request`, and the Worker emails info@promintal.co.uk through Resend (reply-to is the visitor). If sending fails, the page shows an email draft instead.

## Deploy to Cloudflare (gnosis.promintal.com)

1. **Deploy from Git.** Workers & Pages, Create, Import a repository, choose this repo. Deploy command `npx wrangler deploy`, no build command. Every push to `main` redeploys. (Use a Worker, not a Pages project, so the analytics API runs.)
2. **Database.** `wrangler.jsonc` binds a D1 database named `gnosis-website`. Wrangler creates it on the first deploy; tables are created on first use.
3. **Set the admin token.** Worker, Settings, Variables and Secrets, Add. Type *Secret*, name `ADMIN_TOKEN`, value a long random password only you know.
4. **Add the Resend key.** Add another secret named `RESEND_API_KEY` (create a sending-only key in Resend; the gnosis.promintal.com domain is already verified there). Optional variable `MAIL_FROM`, default `Gnosis website <noreply@gnosis.promintal.com>`.
5. **Add the domain.** Worker, Domains, Add Domain, `gnosis.promintal.com`.

## Visitor dashboard

Open `https://gnosis.promintal.com/admin` and enter the `ADMIN_TOKEN`. It refreshes every 15 seconds and shows who is on the site now (city, country, device, page), visits and unique visitors for 24 hours, 7 days and 30 days with a daily chart, top pages, referring sites, download clicks (Mac app and package), demo and contact messages prepared, use of the example chat, countries, devices, and a recent activity feed. Events can be downloaded as CSV.

## Data and privacy

- Tracking runs only on `promintal.com`, and is skipped when the browser sends Do Not Track or Global Privacy Control.
- Stored: page, referring site name, country and city from Cloudflare, device type, a random visitor ID, and download or form-use events. Not stored in visit records: IP addresses, names, emails, form text or chat text. Form text is only emailed. Crawlers are not counted.
- Events are deleted after about 13 months. The notice is in `public/privacy.html`; have it reviewed before relying on it.
- Run locally with `npm install`, create `.dev.vars` containing `ADMIN_TOKEN=...`, then `npx wrangler dev`.

## Licence

All rights reserved, Promintal Consulting Limited. See [LICENSE](LICENSE).

## Downloads

Downloads are switched off until the official launch. The Download buttons show a "not available yet" message and nothing is served. To switch them on later, put the zip files in `public/downloads/` and change the two `data-soon` links on `download.html` back to `downloads/Gnosis-v2-Mac-App.zip` and `downloads/Gnosis-v2.zip` (in `build.py` of the site source).
