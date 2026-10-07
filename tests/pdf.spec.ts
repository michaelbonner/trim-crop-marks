import { test, expect, type Page, type Download } from "@playwright/test";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFPage,
} from "pdf-lib";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

function marks(page: PDFPage, ox = 0, oy = 0) {
  for (const x of [36, 324])
    for (const y of [36, 424]) {
      page.drawLine({
        start: { x: ox + (x === 36 ? 9 : 333), y: oy + y },
        end: { x: ox + (x === 36 ? 27 : 351), y: oy + y },
        thickness: 0.5,
      });
      page.drawLine({
        start: { x: ox + x, y: oy + (y === 36 ? 9 : 433) },
        end: { x: ox + x, y: oy + (y === 36 ? 27 : 451) },
        thickness: 0.5,
      });
    }
}

async function fixture({
  trim = false,
  mixed = false,
  rotation = false,
  offset = false,
  raster = false,
} = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 460]);
  const ox = offset ? -20 : 0,
    oy = offset ? 30 : 0;
  page.setMediaBox(ox, oy, 360, 460);
  if (raster) {
    const png = new PNG({ width: 720, height: 920 });
    png.data.fill(255);
    for (const x of [72, 648])
      for (const y of [72, 848]) {
        for (let px = x === 72 ? 18 : 666; px <= (x === 72 ? 54 : 702); px++) {
          const i = (y * 720 + px) * 4;
          png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
        }
        for (let py = y === 72 ? 18 : 866; py <= (y === 72 ? 54 : 902); py++) {
          const i = (py * 720 + x) * 4;
          png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
        }
      }
    const image = await pdf.embedPng(PNG.sync.write(png));
    page.drawImage(image, { x: ox, y: oy, width: 360, height: 460 });
  } else marks(page, ox, oy);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Keep this text sharp and selectable.", {
    x: 50 + ox,
    y: 200 + oy,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  if (trim) page.setTrimBox(36 + ox, 36 + oy, 288, 388);
  if (rotation) page.setRotation(degrees(90));
  if (mixed) {
    const plain = pdf.addPage([420, 595]);
    plain.drawText("An ordinary page with no crop marks.", {
      x: 40,
      y: 500,
      size: 12,
      font,
    });
  }
  return Buffer.from(await pdf.save());
}

async function upload(page: Page, buffer: Buffer, name = "print.pdf") {
  await page
    .locator("input[type=file]")
    .setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(
    page.getByRole("button", { name: "Download", exact: true }).first(),
  ).toBeVisible();
}

async function bytes(download: Download) {
  const path = await download.path();
  if (!path) throw new Error("Download did not produce a file");
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("sample crops to the marks and downloads a readable, vector PDF", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try a sample PDF" }).click();
  await expect(page.getByRole("status")).toContainText("1 page trimmed");
  await page
    .getByRole("button", { name: "Show preview of field-notes.pdf" })
    .click();
  await expect(page.getByAltText("Result PDF page 1")).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await pending;
  await download.saveAs("tmp/sample-trimmed.pdf");
  expect(download.suggestedFilename()).toBe("field-notes-trimmed.pdf");
  const pdf = await PDFDocument.load(await bytes(download));
  const box = pdf.getPage(0).getMediaBox();
  expect(box.width).toBeCloseTo(288, 0);
  expect(box.height).toBeCloseTo(388, 0);
  expect(pdf.getPage(0).node.Contents()).toBeDefined();
});

for (const [name, options] of [
  ["vector", {}],
  ["trim boundary", { trim: true }],
  ["rotated", { rotation: true }],
  ["offset origin", { offset: true }],
  ["raster marks", { raster: true }],
] satisfies [string, Parameters<typeof fixture>[0]][]) {
  test(`crops ${name} PDFs to the correct page bounds`, async ({ page }) => {
    await upload(page, await fixture(options));
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const pdf = await PDFDocument.load(await bytes(await pending));
    const result = pdf.getPage(0);
    expect(Math.abs(result.getWidth() - 288)).toBeLessThan(1);
    expect(Math.abs(result.getHeight() - 388)).toBeLessThan(1);
    expect(
      Math.abs(result.getMediaBox().x - (options?.offset ? 16 : 36)),
    ).toBeLessThan(1);
    expect(result.getCropBox()).toEqual(result.getMediaBox());
    expect(result.getRotation().angle).toBe(options?.rotation ? 90 : 0);
  });
}

test("keeps unmatched pages unchanged and supports paginated previews", async ({
  page,
}) => {
  await upload(page, await fixture({ mixed: true }));
  await expect(
    page.getByText("1 page trimmed · 1 unchanged", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show preview of print.pdf" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByText("No crop marks detected. This page is unchanged."),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const pdf = await PDFDocument.load(await bytes(await pending));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(1).getSize()).toEqual({ width: 420, height: 595 });
});

test("multiple files create a ZIP with distinct names and exclude damaged PDFs", async ({
  page,
}) => {
  const buffer = await fixture();
  await page.locator("input[type=file]").setInputFiles([
    { name: "same.pdf", mimeType: "application/pdf", buffer },
    { name: "same.pdf", mimeType: "application/pdf", buffer },
    {
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not a PDF"),
    },
  ]);
  await expect(
    page.getByText("Could not read this PDF.", { exact: false }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const archive = unzipSync(await bytes(await pending));
  expect(Object.keys(archive).sort()).toEqual([
    "same-trimmed-2.pdf",
    "same-trimmed.pdf",
  ]);
  for (const buffer of Object.values(archive)) {
    const pdf = await PDFDocument.load(buffer);
    expect(Math.abs(pdf.getPage(0).getWidth() - 288)).toBeLessThan(1);
  }
});

test("ordinary PDFs are returned byte for byte without guessing a crop", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  const plain = pdf.addPage([612, 792]);
  plain.drawText("No printer marks on this page.", { x: 40, y: 600, size: 20 });
  const original = Buffer.from(await pdf.save());
  await upload(page, original);
  await expect(
    page.getByText("No crop marks found", { exact: false }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect(await bytes(await pending)).toEqual(original);
});

test("rejects non-PDFs and can clear a completed batch", async ({ page }) => {
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("alert")).toContainText("please choose a PDF");
  await upload(page, await fixture());
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByRole("region", { name: "Your PDFs" })).toHaveCount(0);
});

test("mobile upload, preview and downloads fit without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(
    page,
    await fixture({ mixed: true }),
    "a-very-long-print-export-filename-for-testing-mobile-layout.pdf",
  );
  await page.getByRole("button", { name: /Show preview/ }).click();
  await expect(
    page.getByRole("button", { name: "Download all as ZIP" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tmp/mobile.png", fullPage: true });
});

test("empty and completed screens meet automated accessibility checks", async ({
  page,
}) => {
  const check = async () => {
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map((v) => ({
        id: v.id,
        elements: v.nodes.map((n) => ({
          target: n.target,
          reason: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  };
  await check();
  await upload(page, await fixture({ mixed: true }));
  await page.getByRole("button", { name: /Show preview/ }).click();
  await check();
});

test("processing a PDF does not send file data to a server", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" ||
      !new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)
    )
      requests.push(`${request.method()} ${request.url()}`);
  });
  await upload(page, await fixture());
  expect(requests).toEqual([]);
});
