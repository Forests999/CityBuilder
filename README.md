# City Map Maker

A browser-based editor for hand-inked fantasy city maps, made for illustrating cities in a homebrew RPG setting book.

**Use it:** https://forests999.github.io/CityBuilder/

## The quick way to a city

1. Press **✨ Generate** (or File → Generate a city…).
2. **Draw outline** (sketch the shape of your city) or **Use selected area**, or leave it blank for a random shape.
3. Pick the number of districts, density, wall, gates, river, farmland and press **Generate city**.

You get a complete, fully editable map: a wall with gates, districts split from your outline and styled by distance from the centre (noble core, townhouses, markets, parks, slums, industry), main roads and a ring road, plazas, large buildings, landmarks, a river and farmland. Ctrl+Z undoes it.

Then refine: select any district and use **Split into districts automatically** to carve it into smaller, differently styled districts, or tune its **Block density** (tighter toward the edge or the centre, like the dense outskirts of a real medieval city).

## Recommended workflow

1. Draw (or generate) the city's whole footprint as one district, often by giving it a wall and letting the district follow it.
2. Use **✂ Split** (K) to cut that footprint into smaller districts, then give each piece its own preset (slums, noble estates, docks…). Pieces that keep the same settings stay seamless, because every district is cut from one shared city-wide street network.
3. Add avenues, plazas, rivers and canals on top. Anything above a district in the Layers list cuts through its blocks, so the block outlines wrap around it with a small gap at rivers and walls.

## Features

- **Walls** with evenly spaced round towers, optional corner towers, and automatic gatehouses wherever an avenue crosses them. Any district can create a wall that traces its outline exactly
- **Districts** that generate their own streets from presets (standard quarter, dense slums, noble estates, radial rings, planned grid, townhouses & lots, docks/industry, park). Block size, street width, curviness, irregularity, pattern and seed can all be tuned. Each district can follow a chosen wall's shape or be clipped to a chosen wall
- **Split tool** to break a large district (or farmland) into smaller pieces along a drawn line
- **Farmland** zones filled with patchwork fields, furrows and hedgerows
- **Rivers & canals** with natural banks, ripples concentrated at the edges, and labels set along the curve
- **Lakes / seas** with layered coastlines
- **Avenues, streets and country roads**: avenues turn into thin country lanes outside the wall
- **Plazas** (statue, fountain, obelisk, ring, tree), **buildings / keeps**, **landmarks** with labels
- **Labels** in several styles with adjustable light halos for readability, **compass rose**, solid or ornate **border**, countryside **field lines**
- **6 themes**: Patina & Amber (default), Ash & Ember, Coastal pastel, Ink & Slate, Old Parchment, Midnight. Every color and font can be overridden
- **Free layer order**: drag layers in the Layers tab, e.g. to put a lake above a river or the other way round
- **Tracing image**: load a sketch and draw over it
- Undo/redo, show/hide/lock layers, autosave in the browser, save/open `.city.json` files, PNG export at 1–3×

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
| K | Split district | | Drag a layer row | reorder layers |
| G | Farmland | | | |

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
| `js/citygen.js` | City generator (outline → districts, roads, river, farmland) and district splitting |
| `js/ui.js` | Property panel schemas and form builder |
| `js/themes.js` | Color themes and fonts |
| `js/geom.js`, `js/rng.js` | Geometry helpers, seeded randomness and noise |

## Notes

- **Open walls:** untick *Closed loop* on a wall to make a free-standing segment. *Wall only free edges* on a district creates open walls along only the borders it does not share with another district.
- **Square plazas** (Q) can be rotated and stretched into rectangles; round plazas are P.
- **Cut away (X):** outline an area to remove it from the districts below it in the layer list, giving a hole, bay or notch inside a district. It can show whatever is underneath, open ground, or a park.
- **Building shapes (J):** stars (4–12 points), squares, rectangles, diamonds, triangles, hexagons, octagons, circles and crosses, with size, rotation and point depth. A building can use the *district blocks* look so it shares the fill, hatching and line weight of the surrounding blocks.
- **Plaza centerpiece → Market stalls:** small squares and rectangles laid out across the plaza.
- **Label borders** can be set per label (or left on the map default); river names have their own opacity.
- **Compass** is a classic faceted rose and can be rotated in its properties.
- Splitting a district also adds a wider street along the cut (delete it in Layers if unwanted).

## Kits, selection and snapping

- **Kits tab:** ready-made groups placed with one click: *City center* (larger civic blocks, sparse parks, main roads out from a central plaza), *Market square* (stall-filled plaza inside a market quarter), *Cemetery* (headstone rows, low wall, gate road, chapel), *Park & garden* (trees, paths, pond, fountain) and *Fortified keep*. Each has a size and seed, and arrives selected together so you can drag it into place.
- **Multi-select:** Shift-click to add or remove, Shift-drag on empty map to box-select, Ctrl+A for everything. Drag any selected item to move them all; the panel offers align (left/center/right/top/middle/bottom), distribute, group/ungroup, duplicate, hide, lock and delete. Kit pieces are grouped; *Select group* in an item's panel selects the rest.
- **District looks:** *Market* (small lots and open squares), *Cemetery* and *Park / garden* presets. Park and cemetery districts fill with trees or headstones; spacing is adjustable.
- **Align streets to roads:** generated organic streets near a hand-drawn road or river run parallel or at right angles to it (toggle per district; grid and radial patterns ignore it on purpose).
- **Street names (Y):** click a road to add a name that runs along its curve; drag it to slide it along.
- **Snap (toolbar, Shift+G):** snaps to corner points and onto edges, shows alignment guides when points line up horizontally or vertically, optional grid, and Shift while drawing locks to 15° steps. Hold Alt to bypass for one action. All of it can be switched off in the Snap menu.

## Interface layout

- **Top bar:** File menu (new, generate, open, save, export), undo/redo/fit, Snap, ✨ Generate, Export PNG.
- **Toolbar:** six groups (select, areas, lines & walls, places, text & compass, edit). Click a group for its current tool; use the corner arrow or right-click for the rest.
- **Right panel:** *Edit* (properties of the selection, in collapsible sections whose open/closed state is remembered), *Layers*, *Generate* (city wizard and kits) and *Map* (page, theme, decoration, colors, tracing image).

## Roads, lines and estimates

- **Gates:** where a gated road crosses a wall, the passage is cut straight through the wall along the road, with its ends flush against the wall's faces and a tower on each side.
- **Adding nodes to lines:** a selected road, wall, river or outline shows round **+** handles at the middle of each segment (on the curve itself for smoothed lines). Drag one to insert a node and move it in one gesture. Ctrl-click anywhere on the selected line also adds a node there, and double-clicking any line adds one without selecting it first.
- **White gap:** buildings, lakes, rivers, walls and cut-aways each have a *White gap around it* setting (or *map default*). Set it to 0 to let blocks run right up to the shape's outline.
- **Roads and districts:** every road cuts cleanly through the blocks and clips at district edges. Each road also has *Generated streets follow it*: on, nearby generated streets line up with the road; off, the district keeps the street layout it would have had without the road.
- **Black border:** buildings, lakes, rivers, plazas, cut-aways, roads and districts each have a *Black border* tick. Turn it off for a plain solid-color shape (for a district, the dark edges between blocks).
