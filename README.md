# Big M Compass

Big M Compass is a lightweight progressive web app (PWA) that turns your phone into a compass pointing toward the nearest McDonald's. The distance is displayed in a playful **Blocks** unit (one block equals one meter), and the design is inspired by retro games.

## Setup

1. Serve the contents of this folder over **HTTPS**. Browsers only allow the Geolocation and Device Orientation APIs on secure origins (`https://` or `localhost`).
2. Ensure the `icons` directory and its PNG files are served alongside `manifest.webmanifest`. These icons are referenced by the PWA manifest.
3. Visit the site on your phone. On first launch the app presents a welcome screen with a button to enable location and motion sensors. Grant these permissions to begin navigation.

This build uses [OpenStreetMap’s Overpass API](https://overpass-api.de/) to find nearby McDonald’s restaurants and therefore **does not require an API key**. If you prefer to use the Google Places API instead, replace the `getNearestMcDonalds()` function in `app.js` with a call to the Google Places “Nearby Search” endpoint and supply your API key.

## How it works

- **Sensors & permissions** – The app asks for geolocation and (on iOS) device orientation permissions. Location updates are continuous, and the orientation sensor drives the compass needle. When orientation access is denied the app falls back to deriving a heading from sequential GPS fixes.
- **Finding the Big M** – Every three minutes or when you move more than 500 m, the app queries the Overpass API for nodes or ways named “McDonald's” within a 50 km radius. The closest result is cached in `localStorage` for five minutes to avoid rate‑limiting.
- **Compass math** – Bearing and distance calculations use the great‑circle and haversine formulas. The needle rotates to `(bearingToTarget − deviceHeading + 360) % 360`. Distance is rounded to the nearest integer and shown as blocks.
- **Offline support** – A service worker caches the app shell (HTML, CSS, JS and icons). When offline the UI loads from cache, but live location updates and Overpass requests still require network connectivity. The app will display the last cached result when offline.

## Notes

- **Trademark** – McDonald's is a trademark of its respective owner. This tool is an unofficial fan project for educational and demonstrative purposes only.
- **iOS specifics** – Safari on iOS requires a user interaction before accessing motion sensors. Use the “Enable Location & Compass” button to grant permission. If you deny sensor access the app will fall back to GPS‑derived headings but may update less smoothly.
- **API limits** – The Overpass API enforces usage limits. If too many requests are made in a short period you may encounter errors or stale results. The built‑in caching mitigates unnecessary calls.

Enjoy finding your nearest Big M with a nostalgic twist!