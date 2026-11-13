# City Map Maker

A browser-based editor for hand-inked fantasy city maps, made for illustrating cities in a homebrew RPG setting book.

You draw the big shapes (wall, rivers, avenues, districts) and the street network fills itself in: dense, crooked alleys in the slums, radial rings around the citadel, planned grids by the docks. Everything stays editable and draggable, and you can export a high-resolution PNG for print.

**Use it:** https://forests999.github.io/CityBuilder/ (after GitHub Pages is enabled, see below)

## Features

- **Walls** with round towers and automatic gatehouses wherever an avenue crosses them
- **Districts** that generate their own streets from presets (standard quarter, dense slums, noble estates, radial rings, planned grid, townhouses & lots, docks/industry, park). Block size, street width, curviness, irregularity, pattern and seed can all be tuned
- **Rivers & canals** with rippled water and labels set along the curve
- **Lakes / seas** with layered coastlines
- **Avenues, streets and country roads**: avenues turn into thin country lanes outside the wall
- **Plazas** (statue, fountain, obelisk, ring, tree), **buildings / keeps**, **landmarks** with labels
- **Labels** in several styles (spaced district caps, gate names, water, script, boxed title), **compass rose**, ornamental **frame**, countryside **field lines**
- **5 themes** (Ash & Ember red, Coastal pastel, Ink & Slate, Old Parchment, Midnight), with every color and font overridable
- **Tracing image**: load a sketch and draw over it
- Undo/redo, layers (show/hide/lock/reorder), autosave in the browser, save/open `.city.json` files, PNG export at 1–3×

## Controls

| Key | Tool | | Action | |
|---|---|---|---|---|
| V | Select & move | | Click / drag | select, move |
| W | Wall | | Drag a square handle | move a point |
| D | District | | Double-click an edge | insert a point |
| A | Lake / sea | | Right-click a point | delete it |
| F | River | | Alt-click | cycle overlapping items |
| N | Canal | | Del | delete selected |
| R | Avenue | | Ctrl+D | duplicate |
| S | Street | | Ctrl+Z / Ctrl+Y | undo / redo |
| U | Country road | | Wheel | zoom |
| P | Plaza | | Space-drag / right-drag | pan |
| B | Building | | Enter / double-click | finish a shape |
| L | Landmark | | Backspace (while drawing) | remove last point |
| T | Text label | | Esc | cancel / deselect |
| C | Compass | | Alt (while drawing) | don't snap |

While drawing, click to place points or drag to sketch freehand.

## Running locally

It's a static site with no build step. Any static file server works. On Windows without Node/Python:

```
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
```

Then open http://localhost:8080/. (Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`.)

## Hosting on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The site updates on every push to `main`.

## Code layout

| File | Purpose |
|---|---|
| `js/main.js` | Editor: tools, mouse/keyboard, panels, files |
| `js/render.js` | Draws a map document to a canvas (screen and export) |
| `js/generate.js` | Procedural street networks and district presets |
| `js/state.js` | Document model, defaults, undo/redo, autosave |
| `js/starter.js` | The "Random city" generator |
| `js/ui.js` | Property panel schemas and form builder |
| `js/themes.js` | Color themes and fonts |
| `js/geom.js`, `js/rng.js` | Geometry helpers, seeded randomness and noise |
