# Cabin Rebuild Mapper

Single-page 3D blueprint/inventory app for labeling, moving, stacking, and rebuilding dismantled cabin parts.

## Features
- Custom existing labels for already-marked pieces
- Manual length / width-depth / height entry
- Color and material per piece
- 3D blocks that can be moved, rotated, scaled, duplicated, deleted
- Layers/sections with show/hide
- Parts list generated from the project
- Simple Illustrator-style custom profile pen tool for odd logs/notches
- Extrude custom 2D profile into a 3D object
- Undo/redo
- Save/load with local browser storage
- Export/import JSON project files
- Mobile-friendly layout

## GitHub Pages
Upload these root files directly to a repository:

- index.html
- styles.css
- app.js
- README.md

Then enable GitHub Pages from the repo settings.

## Notes
This is an MVP build. It uses Three.js from a CDN, so the 3D editor needs internet access on first load unless the library is later bundled locally.
