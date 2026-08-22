# Building Sunlight Analysis Simulator

English | [简体中文](README.zh-CN.md)

A browser-based **building sunlight & daylight simulation** tool: draw houses and walls, watch the sun cast light and shadows in real-time 3D, and run **sunlight-hours analysis** on building facades to check daylight compliance.

> Pure static web app — no backend required, runs in any modern browser; data is stored locally.

---

## Overview

A **sunlight analysis simulator** for buildings and residential planning. Define the site by latitude/longitude, draw houses (buildings) and walls, set floor height and floor count. The app simulates the sun's daily path and shadows in true solar time, renders a **continuous gradient sunlight-hours heatmap** on building facades, and reports per-floor sunlight duration and compliance — supporting daylight and insolation assessment.

Keywords: daylight, sunlight, insolation, sun study, building, house, shadow analysis, solar access, residential planning.

---

## Features

- **Building & wall modeling** — draw buildings and walls in the 2D editor, with quick rectangle drawing, per-floor heights, rotation, dragging, and undo/redo.
- **Real-time 3D sun & shadows** — simulate the sun position by latitude/longitude/date/time; buildings light and darken accordingly; play a one-day light animation with adjustable speed.
- **Sunlight analysis** — for selected facades (south face by default, add/remove by clicking in 3D), accumulate sunlight hours per point in true solar time 08:00–16:00, render a full-facade gradient heatmap (0h red → 8h green), and report per-floor sunlight duration and compliance (2h threshold).
- **Basemap & perspective rectification** — load a satellite/site plan image as a basemap; rectify an obliquely-shot image into an orthographic plan using a 4-point homography.
- **Save & share** — auto-saves to the browser; export/import the project as a JSON file (basemap included).

---

## Live Demo

**https://yc637.github.io/building-sunlight-analysis-simulator/**

---

## Quick Start

### Run locally

Serve over HTTP (not `file://` — pixel access for the basemap/rectification needs a proper origin):

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

### Build from source

```bash
./build.sh      # bundle scene.js and dependencies into bundle.js via esbuild
npm test        # run unit tests (node --test)
```

Only two files are needed at runtime: `index.html` + `bundle.js`.

---

## Deployment

This is a static site — host `index.html` and `bundle.js` on any static host.

**GitHub Pages**: Settings → Pages → deploy from `main` branch, `/ (root)`.

**Nginx**:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/building-sunlight-analysis-simulator;
    index index.html;
}
```

---

## Tech

- Vanilla JavaScript (ES modules), Three.js (3D/WebGL), HTML5 Canvas (2D editor), esbuild for bundling, `node --test` for unit tests.
- No external runtime dependencies, no backend, no database; data is kept in the browser's localStorage.

---

## Notes

- Sunlight analysis is a facade-grid estimation intended for engineering reference.
- China's GB 50180 standard uses different effective sunlight time bands per standard day (Great Cold 08:00–16:00, Winter Solstice 09:00–15:00, both in true solar time); this tool currently uses 08:00–16:00 uniformly.

---

## License

[MIT](LICENSE)
