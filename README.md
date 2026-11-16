# payload-plugin-labels

Labels for Payload: design labels with field tokens in the admin, then print one, a few or every label for a document, on thermal rolls or Avery-style sheets.

**Status:** early checkpoint, version 0.0.0, not published. Built and tested (44 tests): the layout engine in `src/core` (field tokens, text fitting, barcode value checks, sheet grid positions, the 4 x 6 inch thermal preset), and the plugin that adds the three collections with write access closed by default and scope filtering on reads and writes, plus SVG and PDF output drawn from the layout marks, with barcodes, QR and Data Matrix as vectors (bwip-js), and the print endpoint `POST /api/labels/print`. The scope rules are tested against an in-memory MongoDB with two made-up sites. The PDF was checked for page count and page size in points, not opened in a printer or viewer; the SVG was checked as text, not in a browser; no barcode has been scanned. The endpoint is tested by calling its handler against an in-memory MongoDB, not over HTTP. **Not built yet:** sheet (Avery) pages, images in output, sets, the print dialog and button, the admin inspector and live preview. The design is in [docs/design.md](docs/design.md).

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
      access: {
        manage: ({ req }) => req.user?.role === 'admin',
        print: ({ req }) => Boolean(req.user?.canPrint),
      },
      // Per site: scopeField: 'tenant', scopeCollection: 'tenants',
      //   scopeOf: ({ req }) => (req.user?.role === 'platform' ? ALL_SCOPES : req.user?.tenant),
    }),
  ],
})
```

You must set `access.manage` (who may change templates and media), `access.print` (who may print), or both. With neither, the plugin throws when the config loads and names the missing option. Nobody is allowed by default. Only an answer of exactly `true` passes. Templates and media can be read by people the `manage` or `print` check allows, and the print log only by `manage`. With `scopeField`, you also give `scopeOf`, which says which site the person belongs to (an id, `ALL_SCOPES` for a platform admin, or nothing). A person reads and writes only their own site's templates, media and print log, and can also read templates with no site, which only a platform admin can change. No site, an error or no sign-in means no access. A record cannot be moved to another site.



The layout engine works on its own, with no Payload and no React: `import { layout, THERMAL_4X6 } from '@extantape/payload-plugin-labels/core'`. `layout(template, record, media)` returns the marks of one label in millimeters, plus warnings for missing values, text that does not fit and marks outside the label. Text width is estimated from character counts, so fitting is approximate.

Printing: `POST /api/labels/print` with `{ "template": "<key or id>", "ids": [...], "copies": 1 }` returns a PDF, one label per page. It needs a signed-in person with the `print` check (or, with no `print` check, the `manage` check), a scope when `scopeField` is set, a template in their scope, and read access to every document through Payload's own rules for that collection. If any document is missing or unreadable, nothing prints. A request over 2,000 labels (documents times copies) is refused with its count. Each print writes one log entry with the template, collection, document ids, label count and who printed, and never the label text. If the log write fails, nothing is returned. The 4 x 6 in thermal media is used for every template for now.

Output: `renderSvg(layoutResult)` (in `/core`) gives an SVG in millimeters for previews. `renderPdf([layoutResult, ...])` from `@extantape/payload-plugin-labels/pdf` gives a PDF with one label per page, each page the label's size. Both draw the same marks. Images draw as a placeholder box for now.

## License

MIT. See [LICENSE](LICENSE).
