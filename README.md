# Cabin Rebuild Mapper

Single-page 3D blueprint/inventory app for labeling, moving, stacking, and rebuilding dismantled cabin parts.

## Features
- Custom existing labels for already-marked pieces
- Manual length / width-depth / height entry
- Color and material per piece
- 3D blocks that can be moved, rotated, scaled, duplicated, deleted
- Shift-click multi-select
- xTool-style shape builder workflow: build complex shapes from simple blocks
- Merge selected pieces into one custom part
- Subtract cutter pieces from a primary selected part to make notches, odd ends, and cutouts
- Layers/sections with show/hide
- Parts list generated from the project
- Undo/redo
- Save/load with local browser storage
- Export/import JSON project files
- Mobile-friendly layout

## Shape Builder Workflow
1. Add the main piece, such as a Lincoln-log wall section.
2. Add temporary cutter blocks where notches/cutouts should be.
3. Position/rotate/scale the cutters so they pass through the target part.
4. Click the target piece first.
5. Shift-click the cutter pieces.
6. Press **Subtract**.

For combining blocks into one solid part, Shift-click all pieces and press **Merge**.

## GitHub Pages
Upload these root files directly to a repository:

- index.html
- styles.css
- app.js
- README.md

Then enable GitHub Pages from the repo settings.

## Notes
This is an MVP build. It uses Three.js and a Three.js CSG helper from CDNs, so the 3D editor needs internet access on first load unless the libraries are later bundled locally.
