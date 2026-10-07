import { PDFDocument, PDFName, rgb, StandardFonts } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { detectCropMarks, isInsetBox, type Bounds } from "./detection";

GlobalWorkerOptions.workerSrc = workerUrl;

export type PageResult = {
  before: string;
  after: string;
  original: Bounds;
  cropped: Bounds;
  method: "trim" | "marks" | "unchanged";
};
export type CropResult = { bytes: Uint8Array; pages: PageResult[] };

function thumbnail(
  canvas: HTMLCanvasElement,
  bounds?: Bounds,
  rotation = 0,
): string {
  const region = bounds ?? {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  };
  const size = Math.min(1, 520 / Math.max(region.width, region.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(region.width * size));
  small.height = Math.max(1, Math.round(region.height * size));
  small
    .getContext("2d")
    ?.drawImage(
      canvas,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      small.width,
      small.height,
    );
  if (rotation % 360 === 0) return small.toDataURL("image/png");
  const rotated = document.createElement("canvas");
  const quarterTurn = Math.abs(rotation % 180) === 90;
  rotated.width = quarterTurn ? small.height : small.width;
  rotated.height = quarterTurn ? small.width : small.height;
  const context = rotated.getContext("2d");
  context?.translate(rotated.width / 2, rotated.height / 2);
  context?.rotate((rotation * Math.PI) / 180);
  context?.drawImage(small, -small.width / 2, -small.height / 2);
  return rotated.toDataURL("image/png");
}

export async function cropPdf(
  file: File,
  onProgress: (page: number, total: number) => void,
): Promise<CropResult> {
  const input = new Uint8Array(await file.arrayBuffer());
  const pdf = await PDFDocument.load(input, { updateMetadata: false });
  if (pdf.getPageCount() > 300)
    throw new Error(
      "This PDF has more than 300 pages. Split it into smaller files and try again.",
    );
  const loading = getDocument({
    data: input.slice(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  });
  try {
    const rendered = await loading.promise;
    const results: PageResult[] = [];
    for (let index = 0; index < pdf.getPageCount(); index++) {
      onProgress(index + 1, pdf.getPageCount());
      const page = pdf.getPage(index);
      const renderPage = await rendered.getPage(index + 1);
      const initial = renderPage.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(2, 2400 / Math.max(initial.width, initial.height));
      const viewport = renderPage.getViewport({ scale, rotation: 0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context)
        throw new Error("Your browser could not create a PDF preview.");
      await renderPage.render({
        canvasContext: context,
        canvas,
        viewport,
        background: "white",
      }).promise;
      const [vx0, vy0, vx1, vy1] = renderPage.view;
      const original = { x: vx0, y: vy0, width: vx1 - vx0, height: vy1 - vy0 };
      const trim = page.getTrimBox();
      let cropped = original;
      let method: PageResult["method"] = "unchanged";
      if (page.node.has(PDFName.of("TrimBox")) && isInsetBox(trim, original)) {
        cropped = trim;
        method = "trim";
      } else {
        const detected = detectCropMarks(
          context.getImageData(0, 0, canvas.width, canvas.height),
          scale,
        );
        if (detected) {
          const [x0, y1] = viewport.convertToPdfPoint(detected.x, detected.y);
          const [x1, y0] = viewport.convertToPdfPoint(
            detected.x + detected.width,
            detected.y + detected.height,
          );
          const candidate = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          if (isInsetBox(candidate, original)) {
            cropped = candidate;
            method = "marks";
          }
        }
      }
      const before = thumbnail(canvas, undefined, renderPage.rotate);
      const [px0, py1] = viewport.convertToViewportPoint(cropped.x, cropped.y);
      const [px1, py0] = viewport.convertToViewportPoint(
        cropped.x + cropped.width,
        cropped.y + cropped.height,
      );
      const after =
        method === "unchanged"
          ? before
          : thumbnail(
              canvas,
              { x: px0, y: py0, width: px1 - px0, height: py1 - py0 },
              renderPage.rotate,
            );
      results.push({ before, after, original, cropped, method });
      if (method !== "unchanged") {
        for (const setBox of [
          page.setMediaBox,
          page.setCropBox,
          page.setTrimBox,
          page.setBleedBox,
          page.setArtBox,
        ]) {
          setBox.call(
            page,
            cropped.x,
            cropped.y,
            cropped.width,
            cropped.height,
          );
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      renderPage.cleanup();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return {
      bytes: results.some((page) => page.method !== "unchanged")
        ? await pdf.save()
        : input,
      pages: results,
    };
  } finally {
    await loading.destroy();
  }
}

export async function createSample(): Promise<File> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 460]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: 27,
    y: 27,
    width: 306,
    height: 406,
    color: rgb(0.91, 0.94, 0.85),
  });
  page.drawText("FIELD NOTES", {
    x: 55,
    y: 393,
    size: 9,
    font,
    color: rgb(0.25, 0.31, 0.21),
  });
  page.drawText("Less noise.", {
    x: 54,
    y: 316,
    size: 32,
    font: bold,
    color: rgb(0.18, 0.25, 0.14),
  });
  page.drawText("More space.", {
    x: 54,
    y: 275,
    size: 32,
    font: bold,
    color: rgb(0.18, 0.25, 0.14),
  });
  page.drawCircle({ x: 180, y: 170, size: 57, color: rgb(0.45, 0.56, 0.34) });
  page.drawCircle({ x: 213, y: 189, size: 42, color: rgb(0.69, 0.75, 0.56) });
  page.drawText("A little room for something good.", {
    x: 55,
    y: 65,
    size: 11,
    font,
    color: rgb(0.25, 0.31, 0.21),
  });
  for (const x of [36, 324])
    for (const y of [36, 424]) {
      const left = x === 36,
        bottom = y === 36;
      page.drawLine({
        start: { x: left ? 9 : 333, y },
        end: { x: left ? 27 : 351, y },
        thickness: 0.5,
      });
      page.drawLine({
        start: { x, y: bottom ? 9 : 433 },
        end: { x, y: bottom ? 27 : 451 },
        thickness: 0.5,
      });
    }
  return new File([new Uint8Array(await pdf.save())], "field-notes.pdf", {
    type: "application/pdf",
  });
}
