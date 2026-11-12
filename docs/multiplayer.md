# Multiplayer question sync

Multiplayer is optional. Anyone with the game code can join and choose Hider or Seeker. Questions start with **Sync off** and stay in the originating browser. In a game, seekers can share questions and enter answers manually from WhatsApp. Hiders see the shared cards and their lock state. Turning Sync off withdraws a shared card and saves a private copy for the seeker who withdrew it. Other seekers can edit an unlocked shared card, unlock a locked card, or withdraw it. When edits conflict, the server keeps the accepted version and the other seeker sees a message and the current card.

The Pages site calls a separate Worker over HTTPS and uses secure WebSockets for live updates. A SQLite-backed Durable Object is created per game on demand. Games expire 24 hours after creation. The object deletes its room data and closes its connections on expiry. The server stores the game credentials, shared question data and versions, and the information needed to acknowledge retries. Map settings, hider location, and private questions stay on the device. The browser tab retains its game credentials and pending changes across reloads.

## Run locally

Install the app dependencies with `pnpm install`. From the repository root, run these in separate terminals.

```sh
npx wrangler dev
```

```sh
PUBLIC_GAME_WORKER_URL=http://localhost:8787 pnpm dev
```

Open the URL Astro prints on port 4321. If you use a different frontend origin, start Wrangler with `--var ALLOWED_ORIGINS:http://localhost:<port>`. Use Node 24 to match the Pages workflow. In Node versions with server-side Web Storage enabled by default, use `NODE_OPTIONS=--no-experimental-webstorage` for Astro.

For a smoke test, open four separate browser profiles, create a game, join with the game code as a second seeker and two hiders. Add a radius question and check that only its author sees it. Publish it, edit it as the second seeker, answer and lock it, and check all four cards. Unlock it and disconnect one seeker. Edit on both seekers and reconnect the offline seeker after the online edit arrives on the hiders. Check that the offline edit shows as pending, then reports a conflict and displays the accepted value. Turn Sync off and confirm that only the seeker who withdrew the question keeps the latest version. Turn Sync back on to publish it again.

## Deploy from your machine

1. Use a Cloudflare account on the Workers Free plan. From the repository root, run `npx wrangler login`, then `npx wrangler deploy`. Wrangler uses the SQLite migration and binding in `wrangler.jsonc`.
2. In the public GitHub repository, go to **Settings → Secrets and variables → Actions → Variables**. Set `PUBLIC_GAME_WORKER_URL` to the HTTPS Worker URL printed by Wrangler. The Pages workflow injects that public URL when Astro builds. A build without the variable offers solo play.
3. Run the existing **Deploy to GitHub Pages** workflow and repeat the smoke test against the published site. The default origin allowlist includes `https://enwo02.github.io` and the local development origins. For a different Pages owner or custom domain, configure `ALLOWED_ORIGINS` as a comma-separated Worker variable containing the frontend origins.

If Worker deployment is automated later, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Keep any runtime secrets in Cloudflare and expose only the Worker URL in the frontend build.

## Free-tier capacity

At six players per game, 2,000 players per day is about 334 games. At 100 counted requests per game, that is about 33,400 requests per day. Cloudflare currently gives Workers and Durable Objects separate limits of 100,000 requests per day each. Durable Objects also have daily limits of 13,000 GB-seconds, 5 million SQLite rows read, and 100,000 SQLite rows written, plus 5 GB of account storage. At 334 games per day, those daily limits allow roughly 39 GB-seconds and 299 SQLite row writes per game on average. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

The local four-player smoke test used 15 Worker HTTP requests, including preflights and six WebSocket upgrades. The Durable Object handled 11 HTTP requests and nine inbound WebSocket messages, with 7 ms of summed handler time locally. The expiry alarm was scheduled for later. Cloudflare counts upgrades and alarms individually and applies a 20:1 billing ratio to incoming WebSocket messages. Idle connections use WebSocket hibernation. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

After deploying, group invocation logs by `$workers.durableObjectId` and event type to measure per-game request counts and sum the platform CPU and wall-time fields. The Worker emits a game ID, event type, and handler timing for local checks. Use Cloudflare's usage dashboard for billed active duration and SQLite reads and writes. Compare representative six-player games and daily peaks against the free limits, including retries, joins, and room cleanup. If demand outgrows the free tier, project-funded hosting can keep play free. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Observability event fields](https://developers.cloudflare.com/api/resources/workers/subresources/observability/)
