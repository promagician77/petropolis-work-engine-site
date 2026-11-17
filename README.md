# Petropolis Work Engine: demo site

Static site, no build step. Prepared by Santiago.

It runs the real engine (`engine/`, copied from `src/engine` in the kit) in the browser:

- **A pilot day**: 62 reservations, 8 team members, 328 tasks. Scrub the clock, switch to a call-out day, compare Work Engine priority with earliest-due-first, pin or raise a task, change the rules and replay.
- **The Slack cards**: real Block Kit JSON, rendered and tappable, with Slack's limits checked live.
- **Failure lab**: weak signal, ten simultaneous taps, a missed Goose webhook, forged and replayed Slack requests.
- **The AWS build**: architecture, the four records, running cost, downloads, sourced facts.

## Deploy

Upload this folder to Vercel as a static project (framework: none). `vercel.json` sets
`X-Robots-Tag: noindex, nofollow` and serves `.mjs` as JavaScript.

Local: `npx serve .` or any static server (ES modules need http, not file://).

## Measured

- 57 of 57 browser checks pass (Playwright 1.65.1): every asset clicked through, all 6 downloads fetched.
- 0 axe-core 4.14.1 accessibility violations at 1440 px and 390 px; no sideways scrolling at 390 px.
- No console errors and no failed requests.
- Numbers on the page come from `data/results.json`, written by the kit's `npm run measure`.

## Not measured

- Real Slack rendering: the phone is a look-alike that draws the real JSON. Paste the JSON into Slack's Block Kit Builder to check.
- Browsers other than Chromium.
- All pets, people and reservations are invented sample data.
