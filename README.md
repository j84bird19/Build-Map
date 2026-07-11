# Cabin Rebuild Mapper — xTool-Style UI Build

A mobile-first 2D/3D field-mapping app for dismantling, labeling, transporting, and reconstructing cabins and other structures.

## Current build

- xTool-inspired fixed top bar, drafting canvas, rulers, grid, bottom tools, and slide-up panels
- 2D Design, 3D Assembly, and Parts List views
- Custom existing labels for pieces already marked in the field
- Exact length, height, depth, unit, material, color, layer, and notes per part
- Construction primitives: board, beam, log, triangle, trapezoid, circle, wedge, and panel
- Drag, snap, pan, zoom, multi-select, duplicate, delete, lock, hide, fasten/group
- xTool-style boolean workflow: Unite, Subtract, Intersect, and Exclude
- 3D population and assembly with move, rotate, scale, orbit, and fit controls
- Layers with visibility and lock controls
- Measurement mode
- Local autosafe storage plus JSON import/export
- Undo and redo

## GitHub Pages

Upload all four files directly into the root of a new repository:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`

Then enable GitHub Pages under **Settings → Pages**, using the repository's main branch and root folder.

## Technical note

This version loads Three.js from the unpkg CDN. The 2D editor and saved project data are local, but the first 3D load requires internet access. A later production build can bundle Three.js for complete offline operation.

## Boolean-operation note

The current build preserves editable compound-shape definitions and visual subtraction in 2D. Full watertight 3D CSG solids should be added in the next engine pass before using exported geometry for fabrication or structural measurements.
