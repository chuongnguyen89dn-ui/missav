# MissAV link extraction — standalone diagnostic

Run on a single film URL:

```sh
node scripts/extract-links.mjs --url https://missav.ws/vi/fthtd-213 --out data/link-results.json
```

Optional playlist-only check (up to 8 candidate URLs, 12-second timeout each):

```sh
node scripts/extract-links.mjs --url https://missav.ws/vi/fthtd-213 --probe --out data/link-results.json
```

If the page blocks server requests or populates video URLs dynamically, save the page HTML from an authorized browser session and run:

```sh
node scripts/extract-links.mjs --html saved.html --base https://missav.ws/vi/fthtd-213 --out data/link-results.json
```

Output records page URL, code, title/description/poster where present, literal HLS/media URL candidates, UUIDs, hypothetical Surrit mirror URL and optional playlist HTTP status. No playback or segment success is inferred. Do not commit session cookies or signed URLs. No server proxy, crawler or Render traffic is introduced. FTHTD-213 DIRECT playback remains unchanged.

Quality policy: **1080p only**. The extractor excludes 720p/480p and unlabelled master playlists; it does not silently fall back to a lower rendition. If no explicit 1080p candidate is found, output remains empty pending further verification.
