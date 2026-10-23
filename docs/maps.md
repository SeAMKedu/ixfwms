# Lab maps

A map is an SVG drawing attached to a place: a floor plan of the lab, a front view of a cabinet,
a photo of a shelf traced into shapes. You draw it in whatever you like (Inkscape, Illustrator,
Blender's SVG export). ixfwms only needs to know which shapes stand for which places.

## The one rule

Give a shape (or group) the **id `loc:` + the place's code**, for example `loc:A3F9`.
`loc-A3F9` and `loc_A3F9` work too, for tools that don't accept `:` in ids. Everything else in the
drawing is decoration and stays as you drew it.

In Inkscape: select the shape, open **Object › Object Properties** (Ctrl+Shift+O), set **ID**, and
click **Set**.

## Quickest start

1. On a place page (e.g. the lab), open **Map of this place › Download a starter drawing**. You get
   an SVG with one labelled box per place inside it, already carrying the right ids.
2. Open it in Inkscape, move and resize the boxes to match the room (add walls, doors, benches as
   decoration), and save as plain or Inkscape SVG.
3. **Upload SVG map** on the same place page. The check lists which places are linked, which aren't
   drawn yet, and any ids that don't belong there.

Do the same one level down where it helps: a front view of a cabinet with its shelves, a shelf with
its boxes.

## What it does

- **Where is it?** On a part page, **Map** next to a stock entry shows every drawing on the way
  down: the lab plan with the cabinet lit up, then the cabinet's front view with the shelf and box
  lit up.
- On a place page, the same for the place, plus its own drawing.
- Linked shapes are clickable and open that place.

## Notes

- Drawings are cleaned before they're shown: scripts, event handlers, `<foreignObject>` and `<use>`
  references are removed. Uploaded SVGs opened directly are served sandboxed.
- One map per place. Uploading again replaces it, and the old file stays in the file store.
- 3D views (glTF from Blender) can use the same convention later: object names `loc:<code>`.
