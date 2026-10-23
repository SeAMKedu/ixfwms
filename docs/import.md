# Spreadsheets in and out

Two pages read spreadsheets: **Import** (adds parts and stock) and **Can we build it?** (checks a
parts list against stock). Neither needs a fixed format. They read the header row, guess which
column is which from its name, and let you change the guess before anything happens. CSV (comma,
semicolon or tab separated) and Excel `.xlsx` both work; for the parts list you can also paste
rows copied from Excel.

Both pages have **Try with an example**, which loads a small sample so you can see the whole flow,
and a link to download that sample as a starting point:
[import example](../apps/web/public/samples/ixfwms-import-example.csv),
[parts list example](../apps/web/public/samples/ixfwms-parts-list-example.csv).

## Import

Each row becomes a draft part in the Inbox (or in the place you choose), unless its order number or
MPN matches a part we already have; then it adds stock to that part. Nothing is saved until you
press **Import**, and **Check rows** shows first what would happen.

| Field        | Recognised column names (any case)                                                                     | Example                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Name         | Name, Item, Description, Part, Product, Nimi, Nimike, Tuote, Kuvaus                                    | Push-in fitting 6 mm                              |
| Manufacturer | Manufacturer, Maker, Brand, Vendor, Valmistaja, Merkki                                                 | Festo                                             |
| Order number | Order no / number / code, Article no, Part number, Catalog, SKU, Tilausnumero, Tuotenumero, Tuotekoodi | 153032                                            |
| MPN          | MPN, Manufacturer part…                                                                                | QS-6                                              |
| Category     | Category, Group, Type, Kategoria, Ryhmä, Tuoteryhmä                                                    | Pneumatics/Fittings                               |
| Description  | Long description, Details, Lisätiedot                                                                  |                                                   |
| Notes        | Note(s), Comment, Huom, Kommentti                                                                      |                                                   |
| Tags         | Tag(s), Project, Projekti (comma separated)                                                            | cell2, printing                                   |
| Quantity     | Qty, Quantity, Amount, Count, Pcs, Määrä, Kpl, Lukumäärä, Saldo                                        | `20`, `1 234,5`, `20 kpl`                         |
| Unit         | Unit, UoM, Yksikkö: `pcs` (kpl, pc, st, ea), `g`, `kg`, `m`, `mm`, `ml`, `l`                           | g                                                 |
| Level        | Level, Stock level, Taso: `plenty`, `low`, `empty`                                                     | plenty                                            |
| Location     | Location, Place, Bin, Shelf, Box, Sijainti, Paikka, Hylly, Laatikko                                    | `BFH8`, `Robolab-A-3`, `Robotics lab › Cabinet A` |
| Unit mass    | Weight, Mass, Paino (grams per piece, for weighed stock)                                               | 1.2                                               |

- Only **Name** is required. A row without quantity or level adds the part without stock.
- **Location** can be a place code, an address, or a path of names (the end of the path is enough,
  e.g. `Cabinet A › Shelf 3`). Rows whose place isn't found are listed and skipped.
- A mapping you'll use again (say, a supplier's order export) can be saved under a name and
  picked next time.

## Can we build it?

Needs at least a **code** or a **name** column; quantity defaults to 1 per row.

| Field    | Recognised column names                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Order…, Part no / number, Article no, MLFB, Code, MPN, Document Number, Tilaus…, Tuotenumero, Nimikekoodi, Bestell…, Artikelnummer |
| Name     | Name, Description, Title, Nimi, Nimike, Kuvaus, Bezeichnung, Benennung                                                             |
| Quantity | Qty, Quantity, Amount, Count, Pcs, Item Count, Määrä, Kpl, Lukumäärä, Menge, Anzahl                                                |

Parts are matched by code first (order number or MPN), then by name. The example is laid out like
a Solid Edge parts list (Item Number, Document Number, Title, Quantity).

Getting a parts list out of the CAD/automation tools (menu names vary between versions):

- **Solid Edge:** in Draft, save or export the parts list to Excel; or in Assembly, export the
  BOM from the parts list / Assembly Report.
- **NX:** export the Parts List to a spreadsheet (CSV).
- **Inventor:** Bill of Materials › Export, as Excel or CSV.
- **EPLAN:** a Parts list report exported as Excel (or a label/report export to CSV).
- **TIA Portal:** export the hardware/device list (Openness or the device view's export) to Excel;
  the order number column (MLFB) is the code.

Keep the header row; the columns can be in any order and extra columns are ignored.
