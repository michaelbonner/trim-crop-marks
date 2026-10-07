export type Bounds = { x: number; y: number; width: number; height: number };
type Line = { fixed: number; start: number; end: number };
type Corner = { x: number; y: number; gap: number };
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export function detectCropMarks(image: Pixels, scale: number): Bounds | null {
  const { width, height, data } = image;
  const bandX = Math.min(Math.floor(width * 0.22), Math.ceil(100 * scale));
  const bandY = Math.min(Math.floor(height * 0.22), Math.ceil(100 * scale));
  const dark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    return (
      data[i + 3] > 100 &&
      Math.max(r, g, b) < 190 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 65
    );
  };
  const minLength = Math.max(5, Math.floor(5 * scale));
  const maxLength = Math.ceil(60 * scale);
  const thickness = Math.max(2, Math.ceil(2 * scale));
  const tolerance = Math.max(2, 1.5 * scale);

  function lines(x0: number, y0: number, horizontal: boolean): Line[] {
    const found: Line[] = [];
    const across = horizontal ? bandX : bandY;
    const down = horizontal ? bandY : bandX;
    for (let a = 0; a < down; a++) {
      let start = -1;
      for (let b = 0; b <= across; b++) {
        const x = x0 + (horizontal ? b : a);
        const y = y0 + (horizontal ? a : b);
        const ink = b < across && dark(x, y);
        if (ink && start < 0) start = b;
        if (!ink && start >= 0) {
          const length = b - start;
          if (
            length >= minLength &&
            length <= maxLength &&
            start > 0 &&
            b < across
          ) {
            const middle = Math.floor((start + b - 1) / 2);
            const mx = x0 + (horizontal ? middle : a);
            const my = y0 + (horizontal ? a : middle);
            if (
              !dark(
                mx + (horizontal ? 0 : thickness),
                my + (horizontal ? thickness : 0),
              ) &&
              !dark(
                mx - (horizontal ? 0 : thickness),
                my - (horizontal ? thickness : 0),
              )
            ) {
              const line = {
                fixed: horizontal ? y : x,
                start: (horizontal ? x0 : y0) + start,
                end: (horizontal ? x0 : y0) + b - 1,
              };
              if (
                !found.some(
                  (other) =>
                    Math.abs(other.fixed - line.fixed) <= tolerance &&
                    Math.abs(other.start - line.start) <= tolerance,
                )
              )
                found.push(line);
            }
          }
          start = -1;
        }
      }
    }
    return found;
  }

  function corners(right: boolean, bottom: boolean): Corner[] {
    const x0 = right ? width - bandX : 0;
    const y0 = bottom ? height - bandY : 0;
    const hs = lines(x0, y0, true);
    const vs = lines(x0, y0, false);
    const found: Corner[] = [];
    for (const h of hs)
      for (const v of vs) {
        const gapX = right ? h.start - v.fixed : v.fixed - h.end;
        const gapY = bottom ? v.start - h.fixed : h.fixed - v.end;
        if (
          gapX >= scale &&
          gapY >= scale &&
          gapX <= 26 * scale &&
          gapY <= 26 * scale &&
          Math.abs(gapX - gapY) <= 5 * scale
        ) {
          found.push({ x: v.fixed, y: h.fixed, gap: (gapX + gapY) / 2 });
        }
      }
    return found.slice(0, 100);
  }

  const tl = corners(false, false),
    tr = corners(true, false);
  const bl = corners(false, true),
    br = corners(true, true);
  let best: { bounds: Bounds; score: number } | null = null;
  for (const a of tl)
    for (const b of tr) {
      if (Math.abs(a.y - b.y) > tolerance) continue;
      for (const c of bl) {
        if (Math.abs(a.x - c.x) > tolerance) continue;
        for (const d of br) {
          if (
            Math.abs(b.x - d.x) > tolerance ||
            Math.abs(c.y - d.y) > tolerance
          )
            continue;
          const x = (a.x + c.x) / 2,
            y = (a.y + b.y) / 2;
          const w = (b.x + d.x) / 2 - x,
            h = (c.y + d.y) / 2 - y;
          const gaps = [a.gap, b.gap, c.gap, d.gap];
          const spread = Math.max(...gaps) - Math.min(...gaps);
          if (
            spread > 5 * scale ||
            w < width * 0.5 ||
            h < height * 0.5 ||
            x < 2 * scale ||
            y < 2 * scale
          )
            continue;
          const score =
            spread +
            Math.abs(a.x - c.x) +
            Math.abs(b.x - d.x) +
            Math.abs(a.y - b.y) +
            Math.abs(c.y - d.y);
          if (!best || score < best.score)
            best = { bounds: { x, y, width: w, height: h }, score };
        }
      }
    }
  return best?.bounds ?? null;
}

export function isInsetBox(inner: Bounds, outer: Bounds): boolean {
  return (
    Object.values(inner).every(Number.isFinite) &&
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x - 0.1 &&
    inner.y >= outer.y - 0.1 &&
    inner.x + inner.width <= outer.x + outer.width + 0.1 &&
    inner.y + inner.height <= outer.y + outer.height + 0.1 &&
    (inner.width < outer.width - 1 || inner.height < outer.height - 1)
  );
}
