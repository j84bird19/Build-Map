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

## v2.2 touch and field-use update
- Two-finger pinch zoom on the 2D canvas, centered between the fingers.
- Tap an object to select it; drag a selection box across empty canvas to select multiple objects.
- Measure mode now draws the measured line, endpoint markers, and the numeric result directly on the canvas; the latest result also appears when Measure is reopened.
- Layer lock controls now use clear closed-lock and open-lock icons.


## v2.2 interaction corrections

- Two-finger pinch now changes canvas scale around the midpoint between both fingers.
- Browser page panning/zooming is blocked while touching the drafting workspace.
- Selected objects can be resized from any corner handle.
- Selected objects can be rotated from the round handle above the object.
- The top and left rulers stay fixed as a frame around the work area while the design moves beneath them.

## v2.3 locked fixes
- Preserves approved pinch zoom, rotate, resize, and duplicate behavior.
- Duplicated parts retain the exact same user label instead of adding “copy”. Labels remain editable from the Labels panel.
- Boolean-created parts retain the primary part label unless the user changes it.
- Subtract/Exclude are composited on a transparent offscreen layer, preventing the drafting grid or nearby objects from being erased or absorbed into the part.
