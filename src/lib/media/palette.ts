// Deterministic colour tools shared by the browser (logo palette suggestions) and the server
// (submission brand-colour checks). No randomness: the same pixels always give the same palette.

export type RGB = [number, number, number];
export interface Swatch {
  hex: string;
  share: number; // 0..1 of sampled pixels
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** sRGB → OKLab (perceptual space, Euclidean distance ≈ visible difference). */
export function rgbToOklab([r, g, b]: RGB): [number, number, number] {
  const lr = lin(r), lg = lin(g), lb = lin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance between two colours, OKLab × 100 (≈2 is a just-noticeable difference). */
export function deltaE(a: string | RGB, b: string | RGB): number {
  const A = rgbToOklab(typeof a === "string" ? hexToRgb(a) : a);
  const B = rgbToOklab(typeof b === "string" ? hexToRgb(b) : b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 100;
}

/**
 * Dominant colours from raw pixels (RGB or RGBA, row-major). k-means in OKLab with a deterministic
 * farthest-point initialisation; transparent pixels are ignored. Returns swatches sorted by share.
 */
export function extractPalette(pixels: ArrayLike<number>, channels: 3 | 4, k = 6, maxSamples = 12_000): Swatch[] {
  const total = Math.floor(pixels.length / channels);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pts: [number, number, number][] = [];
  const rgbs: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * channels;
    if (channels === 4 && pixels[o + 3] < 128) continue;
    const rgb: RGB = [pixels[o], pixels[o + 1], pixels[o + 2]];
    rgbs.push(rgb);
    pts.push(rgbToOklab(rgb));
  }
  if (!pts.length) return [];
  k = Math.min(k, pts.length);

  // Init: the mean colour's nearest pixel, then repeatedly the pixel farthest from all centroids.
  const mean = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map((v) => v / pts.length);
  const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let first = 0;
  pts.forEach((p, i) => { if (dist2(p, mean) < dist2(pts[first], mean)) first = i; });
  const centroids: number[][] = [pts[first].slice()];
  const nearest = pts.map((p) => dist2(p, centroids[0]));
  while (centroids.length < k) {
    let far = 0;
    nearest.forEach((d, i) => { if (d > nearest[far]) far = i; });
    if (nearest[far] === 0) break;
    centroids.push(pts[far].slice());
    pts.forEach((p, i) => { nearest[i] = Math.min(nearest[i], dist2(p, centroids[centroids.length - 1])); });
  }

  const assign = new Array<number>(pts.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    let moved = 0;
    pts.forEach((p, i) => {
      let best = 0;
      for (let c = 1; c < centroids.length; c++) if (dist2(p, centroids[c]) < dist2(p, centroids[best])) best = c;
      if (assign[i] !== best) { assign[i] = best; moved++; }
    });
    const sums = centroids.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sums.forEach((s, c) => { if (s[3]) centroids[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (iter > 0 && moved === 0) break;
  }

  // Report each cluster as the mean of its member pixels in sRGB (exact, displayable colours)
  const acc = centroids.map(() => [0, 0, 0, 0]);
  rgbs.forEach((rgb, i) => { const a = acc[assign[i]]; a[0] += rgb[0]; a[1] += rgb[1]; a[2] += rgb[2]; a[3]++; });
  const swatches = acc
    .filter((a) => a[3] > 0)
    .map((a) => ({ hex: rgbToHex([a[0] / a[3], a[1] / a[3], a[2] / a[3]]), share: a[3] / pts.length }));

  // Merge near-identical swatches
  const merged: Swatch[] = [];
  for (const s of swatches.sort((a, b) => b.share - a.share)) {
    const twin = merged.find((m) => deltaE(m.hex, s.hex) < 4);
    if (twin) twin.share += s.share;
    else merged.push({ ...s });
  }
  return merged.sort((a, b) => b.share - a.share).map((s) => ({ hex: s.hex, share: Math.round(s.share * 1000) / 1000 }));
}

/** Drops near-white / near-black / grey swatches — useful when suggesting brand colours from a logo. */
export function chromaticSwatches(swatches: Swatch[], minChroma = 6): Swatch[] {
  return swatches.filter((s) => {
    const [, a, b] = rgbToOklab(hexToRgb(s.hex));
    return Math.hypot(a, b) * 100 >= minChroma;
  });
}

export interface ColourMatch {
  brand: string;
  closest: string | null;
  delta: number | null;
  matched: boolean;
  near: boolean;
}

export const COLOUR_MATCH = 10; // OKLab×100: reads as "the same brand colour"
export const COLOUR_NEAR = 18;  // recognisably close

/** Compares brand colours with the swatches found in the work (only swatches covering ≥3% count). */
export function compareToBrand(brandColours: string[], swatches: Swatch[]): { matches: ColourMatch[]; coverage: number } {
  const visible = swatches.filter((s) => s.share >= 0.03);
  const matches = brandColours.map((brand) => {
    let closest: Swatch | null = null;
    let delta = Infinity;
    for (const s of visible) {
      const d = deltaE(brand, s.hex);
      if (d < delta) { delta = d; closest = s; }
    }
    return {
      brand,
      closest: closest?.hex ?? null,
      delta: closest ? Math.round(delta * 10) / 10 : null,
      matched: !!closest && delta <= COLOUR_MATCH,
      near: !!closest && delta <= COLOUR_NEAR,
    };
  });
  const coverage = visible
    .filter((s) => brandColours.some((b) => deltaE(b, s.hex) <= COLOUR_MATCH))
    .reduce((sum, s) => sum + s.share, 0);
  return { matches, coverage: Math.round(coverage * 1000) / 1000 };
}
