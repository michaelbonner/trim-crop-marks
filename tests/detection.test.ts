import { describe, expect, it } from "vitest";
import { detectCropMarks, isInsetBox, type Pixels } from "../src/detection";

function fixture(scale = 1): Pixels {
  const width = 360 * scale,
    height = 460 * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  function line(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0 * scale; y <= y1 * scale; y++)
      for (let x = x0 * scale; x <= x1 * scale; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  }
  for (const x of [36, 324])
    for (const y of [36, 424]) {
      line(x === 36 ? 9 : 333, y, x === 36 ? 27 : 351, y);
      line(x, y === 36 ? 9 : 433, x, y === 36 ? 27 : 451);
    }
  return { width, height, data };
}

describe("crop-mark detection", () => {
  it.each([1, 2])("finds eight matching marks at scale %i", (scale) => {
    const bounds = detectCropMarks(fixture(scale), scale);
    expect(bounds).toEqual({
      x: 36 * scale,
      y: 36 * scale,
      width: 288 * scale,
      height: 388 * scale,
    });
  });
  it("does not crop a blank page", () => {
    const image = fixture();
    image.data.fill(255);
    expect(detectCropMarks(image, 1)).toBeNull();
  });
  it("requires all four corners instead of guessing a missing mark", () => {
    const image = fixture();
    for (let y = 400; y < 460; y++)
      for (let x = 300; x < 360; x++) {
        image.data.fill(255, (y * 360 + x) * 4, (y * 360 + x) * 4 + 4);
      }
    expect(detectCropMarks(image, 1)).toBeNull();
  });
  it("rejects corner artwork made of thick lines", () => {
    const image = fixture();
    const original = image.data.slice();
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        if (original[(y * image.width + x) * 4] !== 0) continue;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            if (
              x + dx < 0 ||
              x + dx >= image.width ||
              y + dy < 0 ||
              y + dy >= image.height
            )
              continue;
            const i = ((y + dy) * image.width + x + dx) * 4;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
          }
      }
    expect(detectCropMarks(image, 1)).toBeNull();
  });
});

describe("trim boundaries", () => {
  const outer = { x: -10, y: 20, width: 360, height: 460 };
  it("accepts a smaller boundary inside an offset page", () =>
    expect(isInsetBox({ x: 26, y: 56, width: 288, height: 388 }, outer)).toBe(
      true,
    ));
  it.each([
    outer,
    { x: -11, y: 56, width: 288, height: 388 },
    { x: 26, y: 56, width: 400, height: 388 },
    { x: 26, y: 56, width: 0, height: 388 },
    { x: 26, y: 56, width: NaN, height: 388 },
  ])("rejects unsafe or unchanged bounds %o", (box) =>
    expect(isInsetBox(box, outer)).toBe(false),
  );
});
