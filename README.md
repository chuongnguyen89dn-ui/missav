# MissAV → Nuvio isolated 1080p playback test

Date started: 2026-09-28. This repository is separate from XemXiec and changes no existing add-on.

## Verified evidence
The FTHTD-213 master playlist advertises a 1920x1080 HLS rendition at 4.38 Mbps average; user confirmed the 1080p URL plays in VLC with HTTP Referer `https://missav.ws/`. Both master and 720p playlist returned HTTP 403 without Referer and HTTP 200 with Referer in the user's diagnostic log.

## Scope and limitations
This is a single-item Stremio-compatible manifest and stream test, *not* a whole-site scraper and *not* proof of Nuvio playback. No server-side video proxy. Nuvio must honor behaviorHints.proxyHeaders.request for playlists and segments or playback will fail. Nuvio compatibility and seek behavior must be observed on the device before a crawler is added. Do not publish as a validated 1080p Nuvio source yet.

## Local test
`npm test` then `npm start`, open `http://localhost:3000/manifest.json`.

## Render deployment
Create a **new** Render web service from this repository, Node environment, build `npm install`, start `npm start` (or use Dockerfile). Set no secret variables. Use `https://<your-new-service>.onrender.com/manifest.json` to add to Nuvio. Only this new service can provide a publicly accessible manifest; a GitHub URL is not a hosted add-on endpoint.

## Next verified milestones
1. Deploy and check /health, /manifest.json, /catalog/movie/missav-test.json, /meta/movie/missav:fthtd-213.json and /stream/movie/missav:fthtd-213.json.
2. Test real Nuvio playback at 1080p, seeking and sustained playback. If headers unsupported, evaluate proxy bandwidth before building one.
3. Extract Surrit URL from multiple pages, verify 1080p and segment responses, then incrementally scan site with throttling and deduplication.

## Progress
- 2026-09-28: Initial standalone test add-on source code; not yet hosted or Nuvio-verified.
