# trim-crop-marks

A small web app that removes PDF crop marks. Drop one PDF or a batch onto the page, review the before/after preview, and download individual PDFs or a ZIP.

Production URL: https://trim-crop-marks.bootpack.work/

All PDF processing runs on the user's device. Files never go to a server, and fonts, PDF rendering resources, and the PDF worker are served with the app.

## Run locally

Requires Node.js 22.12+ and Bun.

```sh
bun install
bun run dev
```

## Build and host

```sh
bun run build
bun run preview
```

Deploy the `dist/` directory to any static host. Include the `pdfjs/` directory and `assets/` directory in the deployment. No backend or environment variables are needed.

## How cropping works

- An explicit, smaller `TrimBox` inside the visible page takes priority.
- Otherwise, PDF.js renders a page locally and the detector looks for eight short, thin, dark marks. Horizontal and vertical pairs must agree at all four corners.
- Each page is checked separately, including rotated pages and pages with nonzero origins.
- Cropping updates the MediaBox, CropBox, TrimBox, BleedBox, and ArtBox. Text, vectors, images, page order, and rotation are preserved. The result is not a rasterized PDF.
- Unmatched pages are left unchanged and flagged. If no pages can be cropped, the original bytes are returned.
- Cropping changes the visible page boundaries. It does not erase off-page content and is not a redaction tool.

This detector is deliberately conservative. Missing corners, angled marks, unusually faint marks, marks far from the page edges, or dense surrounding artwork can prevent detection. Review the preview before using a result. Password-protected PDFs need an unlocked copy.

Batches are limited to 20 files, 50 MB per file, 150 MB total, and 300 pages per file. Memory use also depends on document complexity and the device. Failed files do not prevent the rest of the batch from processing. Duplicate filenames receive numbered output names.

## Checks

```sh
bun run test
bunx playwright install chromium
bun run test:e2e
```

Browser tests run against the production build. They cover vector and raster crop marks, trim metadata, rotation, offset origins, mixed pages, unchanged PDFs, invalid files, duplicate filenames in ZIP downloads, mobile layouts, accessibility, and local processing.

PDF handling uses [PDF.js](https://mozilla.github.io/pdf.js/examples/) for rendering and [pdf-lib's page-box APIs](https://pdf-lib.js.org/docs/api/classes/pdfpage) for the final PDF. ZIP downloads use [fflate](https://github.com/101arrowz/fflate).
