/*
 * Main application logic for Big M Compass
 *
 * This script coordinates sensor access, location queries and UI updates. It
 * requests geolocation and (on iOS) device orientation permissions, polls
 * OpenStreetMap's Overpass API for the nearest McDonald's and updates a
 * compass needle to point toward it. Results are cached in localStorage for
 * 5 minutes and a service worker provides offline support for the app shell.
 */

(function() {
  'use strict';

  /** Application state and behaviour */
  const app = {
    state: {
      currentPos: null,
      lastPosition: null,
      target: null,
      lastFetchTime: 0,
      heading: null,
      courseHeading: null,
      orientationPermissionGranted: false
    },
    init() {
      this.statusEl  = document.getElementById('status-banner');
      this.welcomeEl = document.getElementById('welcome-screen');
      this.cardEl    = document.getElementById('compass-card');
      this.enableBtn = document.getElementById('enable-btn');
      this.recenterBtn = document.getElementById('recenter');
      this.needleEl  = document.getElementById('needle');
      this.ticksContainer = document.getElementById('ticks');
      this.blocksEl  = document.getElementById('blocks');
      this.captionEl = document.getElementById('caption');

      // Create compass tick marks
      this.generateTicks();

      // Register service worker silently if supported
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(() => {/* ignored */});
      }

      // Monitor online/offline events
      window.addEventListener('online',  () => this.setStatus('Back online','success'));
      window.addEventListener('offline', () => this.setStatus('Offline','offline'));

      // Wire up buttons
      this.enableBtn.addEventListener('click', () => this.enableSensors());
      this.recenterBtn.addEventListener('click', () => {
        if (this.state.currentPos) {
          this.state.lastFetchTime = 0;
          this.fetchNearest();
        }
      });

      // If DeviceOrientationEvent is available but doesn't need explicit permission
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') {
        window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
      }
    },
    /** Create 12 ticks around the compass every 30° */
    generateTicks() {
      for (let i = 0; i < 12; i++) {
        const tick = document.createElement('div');
        tick.className = 'tick';
        // Position ticks by rotation and translation; centre at 0,0 then rotate
        tick.style.transform = `rotate(${i * 30}deg) translate(-50%, -50%)`;
        this.ticksContainer.appendChild(tick);
      }
    },
    /** Prompt the user for sensor permissions and begin watching position */
    enableSensors() {
      // Hide welcome and reveal main interface
      this.welcomeEl.classList.add('hidden');
      this.cardEl.classList.remove('hidden');
      this.recenterBtn.classList.remove('hidden');

      // On iOS, DeviceOrientationEvent requires a user gesture to request permission
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
          if (state === 'granted') {
            this.state.orientationPermissionGranted = true;
            window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
          } else {
            this.setStatus('Sensor access denied','warning');
          }
        }).catch(() => {
          // Permission request failed or user dismissed the prompt
          this.setStatus('Sensor access denied','warning');
        });
      }
      // Always begin location watch
      this.startGeolocation();
    },
    /** Begin watching the user's position via the Geolocation API */
    startGeolocation() {
      if (!navigator.geolocation) {
        this.setStatus('Geolocation not supported','error');
        return;
      }
      this.setStatus('Using your location','info');
      this.geoId = navigator.geolocation.watchPosition(
        pos => {
          const coords = pos.coords;
          this.state.currentPos = coords;
          // Derive course heading from successive GPS fixes if orientation unavailable
          if (this.state.lastPosition) {
            const last = this.state.lastPosition;
            const dist = haversineMeters(last.latitude, last.longitude, coords.latitude, coords.longitude);
            if (dist > 2) {
              const course = computeBearing(last.latitude, last.longitude, coords.latitude, coords.longitude);
              this.state.courseHeading = course;
            }
          }
          this.state.lastPosition = { latitude: coords.latitude, longitude: coords.longitude };
          this.update();
        },
        err => {
          if (err.code === 1) {
            this.setStatus('Location denied','error');
          } else {
            this.setStatus('Location error','error');
          }
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    },
    /** Update orientation heading when sensor events fire */
    handleOrientation(event) {
      let heading = null;
      // On iOS with compass calibration, webkitCompassHeading yields true heading
      if (event.webkitCompassHeading != null) {
        heading = event.webkitCompassHeading;
      } else if (event.alpha != null) {
        // On other platforms compute heading from alpha, adjusting for screen orientation
        let alpha = event.alpha;
        const orientation = screen.orientation && screen.orientation.angle ? screen.orientation.angle : 0;
        heading = alpha - orientation;
        if (heading < 0) heading += 360;
      }
      if (heading != null) {
        this.state.heading = heading;
        this.update();
      }
    },
    /** Request the nearest McDonald's from the data layer */
    fetchNearest() {
      const pos = this.state.currentPos;
      if (!pos) return;
      this.setStatus('Searching for the Big M…','info');
      getNearestMcDonalds(pos.latitude, pos.longitude).then(target => {
        this.state.target = target;
        this.state.lastFetchTime = Date.now();
        this.captionEl.textContent = target.name + (target.city ? ', ' + target.city : '');
        this.setStatus('On target','success');
        this.update();
      }).catch(() => {
        this.setStatus('Search failed','error');
      });
    },
    /** Primary update loop: recompute bearings and update the UI */
    update() {
      const pos = this.state.currentPos;
      if (!pos) return;
      const now = Date.now();
      const target = this.state.target;
      // Refresh nearest location every 3 minutes or when user moves >500 m
      if (!target || (now - this.state.lastFetchTime) > 3 * 60 * 1000 ||
          (target && haversineMeters(pos.latitude, pos.longitude, target.lat, target.lon) > 500)) {
        this.fetchNearest();
      }
      // If we have a target, update distance and needle
      if (target) {
        const dist = haversineMeters(pos.latitude, pos.longitude, target.lat, target.lon);
        this.updateDistance(dist);
        // Choose device heading: orientation sensor preferred, else course from GPS
        let deviceHeading = null;
        if (this.state.heading != null) {
          deviceHeading = this.state.heading;
        } else if (this.state.courseHeading != null) {
          deviceHeading = this.state.courseHeading;
        }
        if (deviceHeading != null) {
          const bearingTo = computeBearing(pos.latitude, pos.longitude, target.lat, target.lon);
          const angle = (bearingTo - deviceHeading + 360) % 360;
          this.updateNeedle(angle);
        }
      }
    },
    /** Rotate the needle to a given angle (degrees clockwise from north) */
    updateNeedle(angle) {
      const now = performance.now();
      // Throttle updates to roughly 12 FPS
      if (!this.lastNeedleUpdate || now - this.lastNeedleUpdate > 80) {
        this.lastNeedleUpdate = now;
        this.needleEl.style.transform = `translate(-50%, -90%) rotate(${angle}deg)`;
      }
    },
    /** Update the distance readout in blocks (1 m = 1 block) */
    updateDistance(meters) {
      const blocks = Math.round(meters);
      this.blocksEl.textContent = blocks.toString();
    },
    /** Show a transient message in the status banner */
    setStatus(text, type) {
      // type: info, success, error, warning, offline
      const el = this.statusEl;
      el.textContent = text;
      el.className = 'status ' + type;
    }
  };

  /** Convert degrees to radians */
  function toRadians(deg) { return deg * Math.PI / 180; }
  /** Convert radians to degrees */
  function toDegrees(rad) { return rad * 180 / Math.PI; }

  /** Compute the great‑circle bearing from one point to another */
  function computeBearing(lat1, lon1, lat2, lon2) {
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δλ = toRadians(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return (toDegrees(θ) + 360) % 360;
  }

  /** Compute distance in metres between two lat/lon pairs using the haversine formula */
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // mean Earth radius in metres
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const dφ = toRadians(lat2 - lat1);
    const dλ = toRadians(lon2 - lon1);
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /** Data layer: query the Overpass API for the nearest McDonald's */
  function getNearestMcDonalds(lat, lon) {
    // Try to load a cached result
    const cache = localStorage.getItem('bigm-cache');
    if (cache) {
      try {
        const cached = JSON.parse(cache);
        if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
          return Promise.resolve(cached.data);
        }
      } catch (e) {}
    }
    // Build Overpass QL query searching for McDonald's within ~50 km
    const radius = 50000;
    const query = `\n      [out:json][timeout:25];\n      (\n        node[\"name\"=\"McDonald's\"](around:${radius},${lat},${lon});\n        way[\"name\"=\"McDonald's\"](around:${radius},${lat},${lon});\n        relation[\"name\"=\"McDonald's\"](around:${radius},${lat},${lon});\n      );\n      out center tags;\n    `;
    const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);
    return fetch(url).then(resp => {
      if (!resp.ok) throw new Error('Network error');
      return resp.json();
    }).then(data => {
      if (!data.elements || data.elements.length === 0) {
        throw new Error('No results');
      }
      let nearest = null;
      let minDist = Infinity;
      data.elements.forEach(el => {
        const elLat = el.lat || (el.center && el.center.lat);
        const elLon = el.lon || (el.center && el.center.lon);
        if (elLat != null && elLon != null) {
          const d = haversineMeters(lat, lon, elLat, elLon);
          if (d < minDist) {
            minDist = d;
            nearest = {
              id: el.id,
              name: (el.tags && el.tags.name) || "McDonald's",
              lat: elLat,
              lon: elLon,
              city: (el.tags && (el.tags['addr:city'] || el.tags['addr:town'] || el.tags['addr:village'] || el.tags['addr:hamlet'])) || ''
            };
          }
        }
      });
      if (!nearest) throw new Error('No results');
      localStorage.setItem('bigm-cache', JSON.stringify({ timestamp: Date.now(), data: nearest }));
      return nearest;
    });
  }

  // Expose the app globally for debugging
  window.BigMCompass = app;

  // Initialise the app when DOM is ready
  window.addEventListener('DOMContentLoaded', () => {
    app.init();
  });
})();