// Renders the raster icons and Open Graph image in public/ from the sources in brand/.
// Run with: bun run brand
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

const brand = import.meta.dirname;
const out = join(brand, "..", "public");

async function renderSvg(page: Page, file: string, size: number) {
  const svg = readFileSync(join(brand, file), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true });
}

// ICO files can embed PNG images directly.
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

const browser = await chromium.launch();
const page = await browser.newPage();

const favicon = join("..", "public", "favicon.svg");
writeFileSync(
  join(out, "favicon.ico"),
  ico([
    { size: 16, png: await renderSvg(page, favicon, 16) },
    { size: 32, png: await renderSvg(page, favicon, 32) },
    { size: 48, png: await renderSvg(page, favicon, 48) },
  ]),
);
writeFileSync(
  join(out, "apple-touch-icon.png"),
  await renderSvg(page, "icon-square.svg", 180),
);
writeFileSync(join(out, "icon-192.png"), await renderSvg(page, favicon, 192));
writeFileSync(join(out, "icon-512.png"), await renderSvg(page, favicon, 512));
writeFileSync(
  join(out, "icon-maskable-512.png"),
  await renderSvg(page, "icon-maskable.svg", 512),
);

await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(pathToFileURL(join(brand, "og-image.html")).href);
await page.evaluate(() => document.fonts.ready);
writeFileSync(join(out, "og-image.png"), await page.screenshot());

await browser.close();
