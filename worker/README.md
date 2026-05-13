# Estimate Guard Worker

Cloudflare Worker layer for protecting the estimate API from scraping and abnormal request patterns.

## What it blocks

- Requests from unapproved origins
- Non-browser or automation-like user agents
- Oversized or invalid JSON payloads
- Repeated identical estimate requests
- Excessive requests per IP and browser fingerprint
- Honeypot field submissions
- Turnstile failures when `TURNSTILE_SECRET` is configured

## Required setup

1. Create a Cloudflare KV namespace and replace the IDs in `wrangler.jsonc`.
2. Set `ALLOWED_ORIGINS` to the real production site origin.
3. Add secrets:

```bash
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put INTERNAL_API_TOKEN
```

`TURNSTILE_SECRET` is optional during development but should be enabled in production.
`INTERNAL_API_TOKEN` is only needed if this Worker proxies to another private estimate API.

## Connecting an estimate engine

There are two supported patterns:

- Put the estimate calculation directly inside this Worker after `decision.allow`.
- Set `ORIGIN_ESTIMATE_URL` and let this Worker proxy only clean requests to the private estimate API.

The browser should call only:

```text
POST /api/estimate
```

Do not ship unit prices, weighting rules, or estimate source data to the browser.
