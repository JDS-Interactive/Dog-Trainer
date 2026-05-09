# LMA Dog Trainer

**LMA Dog Trainer** is a standalone, installable, offline-first Progressive Web App for dog trainers, dog owners, handlers, and training programs.

The app is intentionally broad and applies to all dogs, not only working dogs or police/military K9s.

## Current Features

- Dog profiles
- Profile photo capture/upload
- Training session logs
- Audio cue library
- MP3/WAV audio import
- Direct in-app audio recording where supported by the browser
- Audio playback after saving
- Progress tracking
- ZIP pack export/import
- Offline-first service worker
- Installable PWA manifest
- Mobile-safe storage fallback

## Storage Architecture

The app uses a manifest-plus-media approach.

Metadata is stored locally as JSON. Media files are stored separately using the best available browser storage method:

1. OPFS when available
2. IndexedDB fallback
3. localStorage media fallback as a last resort

ZIP exports include:

```text
pack.json
media/photos/
media/audio/
```

This avoids bloated base64-only JSON exports while still allowing a complete portable training pack.

## Offline / Install Support

This project includes:

- `manifest.webmanifest`
- `service-worker.js`
- PNG app icons
- Apple touch icon
- Cached core assets

After the first successful load, the application should continue opening offline from the same browser/device.

## Local Testing

Use a local server. Do not open `index.html` directly from the file system.

Example:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

For iPhone testing from another device on the same LAN, use the host machine's local IP address.

Example:

```text
http://192.168.1.25:8080
```

For full PWA install behavior, camera/microphone permissions, and a production-like environment, deploy to HTTPS such as GitHub Pages.

## GitHub Pages Deployment

1. Create a GitHub repository.
2. Upload all files from this folder.
3. In the repository settings, enable GitHub Pages.
4. Set the Pages source to the main branch/root folder.
5. Open the published GitHub Pages URL.
6. Add/install the app to the device home screen.

## Suggested Future Premium Features

Video recording should be reserved for a future Pro/Premium trainer tier because it creates higher-value deliverables:

- Session review
- Remote coaching
- Proof-of-progress clips
- Client handoff videos
- Paid training packs

## Project Direction

This standalone version should remain useful on its own. Later, it can also become an encrypted payload inside the broader LMA App Library licensing ecosystem.
