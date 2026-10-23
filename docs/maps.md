# Lab maps

A map is a drawing attached to a place: a floor plan of the lab, a front view of a cabinet, a
shelf traced into shapes, or a 3D model of the room. Draw it in whatever you like (Inkscape,
Illustrator, Blender). The drawing doesn't need anything special: which shape stands for which
place is set in ixfwms, by clicking.

## Quickest start

1. On a place page (e.g. the lab), open **Map of this place › Download a starter drawing**. You get
   an SVG with one labelled box per place inside it, already linked.
2. Open it in Inkscape, move and resize the boxes to match the room (add walls, doors, benches as
   decoration), and save.
3. **Upload SVG map** on the same place page. The check below the map lists what's linked, which
   places have no shape yet, and links that lost their shape.

Or upload any drawing and link it by hand:

1. **Link shapes**, then click a shape in the drawing.
2. Pick the place it stands for: the places inside this one that have no shape yet are offered as
   buttons; any deeper place can be found by name.
3. Clicked a part of a group (a line of the cabinet outline)? **Select the group around it** steps
   out to the enclosing group.

Shapes without an id get one when the drawing is uploaded, so links survive edits as long as you
edit the same file. Do the same one level down where it helps: a cabinet front with its shelves, a
shelf with its boxes.

## One drawing, many places

Seven identical cabinets need one drawing, not seven:

- **Copy a place** (the Copy button on a place page) copies a cabinet with all its shelves and
  boxes, with new codes, named on (Cabinet A → Cabinet B, C…). The copies use the same drawing,
  linked to their own shelves. Parts and stock aren't copied.
- For cabinets that already exist: on the cabinet, **Or use a drawing from the library**, pick the
  drawing, and **Linked like** another cabinet. Links are matched by name (Shelf 3 ↔ Shelf 3), or by
  position if the names differ. **Link like** on a place whose map is shared does the same later.
- **Replace map** on a shared drawing updates every place that uses it (you're asked first). If a
  shape was removed or lost its id, its links are listed as lost, on the place and on
  **More › Maps**. Uploading on the place page with **Upload** instead gives just that place a
  drawing of its own.

**More › Maps** lists every drawing, which places use it, how many links each has and how many are
lost. Drawings can be renamed, replaced, and removed once no place uses them.

## What it does

- **Where is it?** On a part page, **Map** next to a stock entry shows every drawing on the way
  down: the lab plan with the cabinet lit up, then the cabinet's front view with the shelf and box
  lit up.
- On a place page, the same for the place, plus its own drawing.
- Linked shapes are clickable and open that place.
- One map is shown at a time, with a tab per level (lab, cabinet…) and a 2D/3D switch. It opens
  on the most detailed level showing the place, zoomed in around it (**Whole map** zooms out), and
  can be expanded to fill the screen (Esc to go back). On a computer the map sits beside the
  lists on a place page; on a phone it's behind a **Map** button.
- Shapes standing for an overdue temporary place, or for something holding one (the floor zone a
  forgotten pallet is on), are marked amber.

## Linking in the drawing tool instead

A shape (or group) whose **id is `loc-` + a place's code**, e.g. `loc-A3F9`, links by itself.
`loc:A3F9` and `loc_A3F9` work too. In Inkscape: **Object › Object Properties** (Ctrl+Shift+O),
set **ID**, **Set**. Links made by clicking win over these names. When a place is copied, its name
links become click links for the copies, since the copies have new codes.

## 3D models (Blender)

The same in 3D: export the lab from Blender as **binary glTF (.glb)** and upload it on the place
page, the same way as an SVG. Link objects by clicking them, or name them `loc-<code>`.

- An object can be an **Empty** that groups a cabinet's meshes; then the whole group lights up.
  When linking by clicking, **Select the group around it** steps from a mesh to its parent.
  Blender's `.001` suffixes are ignored in `loc-` names.
- Export: **File › Export › glTF 2.0**, format **glTF Binary (.glb)**. Under _Include_, keep object
  names (the default). Apply modifiers. Keep textures modest so phones can load it.
- In the app, the path to the place is tinted and labelled, and the camera turns to the target.
  You can drag to orbit, scroll or pinch to zoom, and click a linked object to open that place.
  With nothing to highlight, the model slowly turns, as on a dashboard.

The 3D viewer (three.js) loads only when a 3D map is shown, so the rest of the app stays light.

## Notes

- Drawings are cleaned before they're shown: scripts, event handlers, `<foreignObject>` and `<use>`
  references are removed. Uploaded SVGs opened directly are served sandboxed.
- A place has at most one 2D drawing and one 3D model; "where is it" shows both, 3D first.
- Old versions of drawings stay in the file store.
