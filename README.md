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

## GHCR and Dokploy

Pushing to `main` runs the checks, builds a Linux amd64 container on GitHub, and publishes these tags:

- `ghcr.io/michaelbonner/trim-crop-marks:latest`
- `ghcr.io/michaelbonner/trim-crop-marks:<full-commit-sha>`

The workflow uses the repository's built-in `GITHUB_TOKEN` to publish a new, repository-linked package. An optional `GHCR_TOKEN` secret can override this for an existing package with separate permissions.

Create an application in Dokploy using the Docker source. Add `trim-crop-marks.bootpack.work` in its Domains tab, enable HTTPS, and set the container port to **8080**. No database, volume, or application environment variables are needed.

Add these repository secrets in GitHub Settings → Secrets and variables → Actions:

| Secret                   | Value                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `DOKPLOY_URL`            | `https://dokploy.bootpack.dev`                                                           |
| `DOKPLOY_API_KEY`        | Your existing Dokploy API key with access to this application                            |
| `DOKPLOY_APPLICATION_ID` | The application ID, not the project or environment ID                                    |
| `GHCR_PULL_TOKEN`        | For a private GHCR package, a classic PAT with `read:packages` and access to the package |

For an anonymous pull, make the GHCR package public and leave `GHCR_PULL_TOKEN` unset. Public repositories do not automatically make their container packages public. The workflow verifies pull access before changing Dokploy's registry credentials.

When the three Dokploy secrets are present, the workflow pins the application to the commit tag, selects the Docker source, disables Dokploy's own Git auto-deploy, and requests a deployment. Runs are serialized so production updates cannot interleave. A deployment request being accepted is not a health check; confirm the rollout in Dokploy.

Until those secrets are configured, the workflow publishes the image and explicitly reports that deployment was skipped. After configuring them, run **Build & Deploy (Dokploy)** manually from the Actions tab. Manual production deployments are restricted to `main`.

The runtime uses unprivileged nginx. Hashed assets receive immutable caching, HTML is revalidated, PDF worker modules receive a JavaScript MIME type, and `/health` provides a container health check.

To build and test the same container locally:

```sh
docker build -t trim-crop-marks:local .
docker run --rm -p 8080:8080 trim-crop-marks:local
```

In another terminal:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:8080 bun run test:e2e
```

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
