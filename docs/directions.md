# Directions: how to find a place

An address like `Robolab-B-2` is enough for a label, but not for someone asking a voice assistant
"where is the hammer?". Two optional fields on a place turn it into _"in the grey cabinet next to the
project workbench, second shelf from the bottom"_. Both are set under **Edit** on the place page.

## How to find it (hint)

A few words on where the place is **inside the place it's in**, for someone who has just got there:

| Place               | Hint                                                |
| ------------------- | --------------------------------------------------- |
| Robotics lab        | Second floor, at the end of the corridor            |
| Machine vision area | Far corner by the windows                           |
| Cabinet B           | Grey two-door cabinet next to the project workbench |
| Shelf 2             | _(none: the cabinet's numbering says it)_           |
| Box: vacuum parts   | Behind the blue bin, at the back                    |

- Name landmarks and what it looks like ("grey", "two-door", "with the red label"), not what's in
  it: the inventory already knows that.
- Write it from the point of view of someone walking into the parent, so "left" and "right" mean
  something.
- Leave it empty when the name and numbering already say enough.
- Use the same language as the other fields. The assistant translates hints when it answers in
  another language, and keeps place names and codes as written, so they match the labels.

A moved container (box, bin, pallet) forgets its hint: "behind the blue bin" was about where it
used to be. A copied place starts without a hint of its own but keeps the hints of the places
inside it.

## Places inside are numbered

Says which way the places inside are counted: from the bottom, top, left or right. A cabinet with
shelves numbered from the bottom makes "Shelf 2" _the second shelf from the bottom_.

Places are counted among those of the same type next to them, in order of their **short names**,
or their names where no short name is set. Numbers sort as numbers (1, 2, 10). So a drawer can be
named after what's in it ("M3×10 DIN 912") with short name `2`, and still be the second one.

## Asking an assistant

Over MCP, `where_is` returns `directions` with each answer: the way down to the place, each step
with its hint and its position ("2 of 5 from the bottom"). The assistant puts that into one
sentence and leaves out what you already know, such as the building and room. Hints can be set by
voice too: _"note that cabinet B is next to the project workbench"_ (`update_location`).

## Example: a small-parts drawer cabinet

A cabinet of 12 rows with 4 small drawers each:

```
Cabinet C              cabinet, numbered from the top
├─ Row 1               row, numbered from the left
│  ├─ M3 screws        drawer, short name 1
│  ├─ M4 screws        drawer, short name 2
│  └─ …
└─ Row 12
```

1. Add a **Row** place type in **More › Settings › Place types** (not movable), so directions say "row"
   rather than "shelf".
2. Make the cabinet, set **Places inside are numbered** to _From the top_.
3. Make Row 1, numbered _From the left_, with its four drawers; then **Copy** Row 1 eleven times.
   Copies are named on (Row 2, Row 3, …) and keep the drawers and the numbering.
4. Name the drawers after their contents and give them short names `1` to `4`. Drawers are
   containers, so their labels show their name (on 12 mm tape and wider): the label says what's in
   the drawer.

For a map, draw the cabinet front once with all the drawers and attach it to the cabinet: shapes
can be linked to any place below it, not only the rows. Identical cabinets can use the same drawing
(see [lab maps](maps.md)).
