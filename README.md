# payload-plugin-labels

Labels for Payload: design labels with field tokens in the admin, then print one, a few or every label for a document, on thermal rolls or Avery-style sheets.

**Status:** early checkpoint, version 0.0.0, not published. Built and tested (34 tests): the layout engine in `src/core` (field tokens, text fitting, barcode value checks, sheet grid positions, the 4 x 6 inch thermal preset), and the plugin that adds the three collections with write access closed by default and scope filtering on reads and writes, plus SVG and PDF output drawn from the layout marks, with barcodes, QR and Data Matrix as vectors (bwip-js). The scope rules are tested against an in-memory MongoDB with two made-up sites. The PDF was checked for page count and page size in points, not opened in a printer or viewer; the SVG was checked as text, not in a browser; no barcode has been scanned. **Not built yet:** sheet (Avery) pages, images in output, the print endpoint and dialog, the admin inspector and live preview, and the writes to the print log. The design is in [docs/design.md](docs/design.md).

## What it will do (the plan)

- A label builder in the admin: pick the label size and the roll or sheet, then place text, barcodes, QR codes, images and lines. Field tokens such as `{{order.customer.name}}` fill them from the document, so labels always carry live data.
- A "Print labels" menu on each document: print one label, a few, or every label that belongs to it, such as an order's box label and one label per kit.
- Output as PDF for any printer: one label per page for thermal printers, or a sheet grid (Avery 5160 and others) with a start position for partly used sheets. ZPL for Zebra printers comes in 0.3.
- Labels show only fields the person printing may read.
- Works on any Payload site by itself. Other plugins can offer ready-made labels through a small adapter, with no dependency either way.

## On its own, and with others

This part is still the plan from [docs/design.md](docs/design.md).

**On its own:** Labels will work on any Payload site with no other plugin. You design labels in the admin from your own collections' fields, and print them from each document.

**Works with** (planned for 0.3, each through `config.custom.labels.providers`, with no import either way):
- **Kitting:** ready-made labels for built units, supply lots and shelves.
- **Restock:** a receiving label for each received order.
- **Sample Kits:** kit bag, kit box, shipping box and lab batch labels. Its `adapters.labels` is already typed for this.
- **OneTaxonomy:** offered through the same kind of adapter.

**Family:** Labels sits in the Fulfillment family, with Kitting, Restock, Sample Kits, Shipping, Scan, Wizards, Custody and Sequences, though the families are a working draft and Fulfillment is due to be split into different groups.

## Install or build

Not published yet. It will be `@extantape/payload-plugin-labels` on npm. To build it here: `npm install`, `npm test`, `npm run build`.

## Use

```ts
import { labelsPlugin } from '@extantape/payload-plugin-labels'

export default buildConfig({
  plugins: [
    labelsPlugin({
      access: { manage: ({ req }) => req.user?.role === 'admin' },
      // Per site: scopeField: 'tenant', scopeCollection: 'tenants',
      //   scopeOf: ({ req }) => (req.user?.role === 'platform' ? ALL_SCOPES : req.user?.tenant),
    }),
  ],
})
```

With no `access` given, nobody can write labels through the API and only signed-in people can read them. With `scopeField`, you also give `scopeOf`, which says which site the person belongs to (an id, `ALL_SCOPES` for a platform admin, or nothing). A person reads and writes only their own site's templates, media and print log, and can also read templates with no site, which only a platform admin can change. No site, an error or no sign-in means no access. A record cannot be moved to another site.

A check counts only if it returns exactly `true`; an error counts as no.

The layout engine works on its own, with no Payload and no React: `import { layout, THERMAL_4X6 } from '@extantape/payload-plugin-labels/core'`. `layout(template, record, media)` returns the marks of one label in millimeters, plus warnings for missing values, text that does not fit and marks outside the label. Text width is estimated from character counts, so fitting is approximate.

Output: `renderSvg(layoutResult)` (in `/core`) gives an SVG in millimeters for previews. `renderPdf([layoutResult, ...])` from `@extantape/payload-plugin-labels/pdf` gives a PDF with one label per page, each page the label's size. Both draw the same marks. Images draw as a placeholder box for now.

## License

MIT. See [LICENSE](LICENSE).
