// Zuschnitt eines Fotos auf den Bereich mit den Ziffern. Dieselbe Formel steckt in der Vorschau
// von Web (web/src/lib/image.ts) und App (PhotoViews.kt) – gespeichert wird genau, was man sieht.

/** [links, oben, Breite, Höhe] als Anteile 0–1 der Bildgröße */
export type Box = [number, number, number, number];

/** Anteile 0–1: Bereich aller Ziffern plus großzügiger Rand (die Lage aus der Erkennung ist nur ungefähr). */
export function cropFraction(boxes: Box[]): Box | null {
  const valid = boxes.filter((b) => Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === 'number' && Number.isFinite(x)));
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((b) => b[0]));
  const top = Math.min(...valid.map((b) => b[1]));
  const right = Math.max(...valid.map((b) => b[0] + b[2]));
  const bottom = Math.max(...valid.map((b) => b[1] + b[3]));
  const padX = (right - left) * 0.25 + 0.03;
  const padY = (bottom - top) * 0.6 + 0.03;
  const x0 = Math.max(0, left - padX);
  const y0 = Math.max(0, top - padY);
  const x1 = Math.min(1, right + padX);
  const y1 = Math.min(1, bottom + padY);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Pixel-Rechteck für sharp.extract; null, wenn der Ausschnitt kaum kleiner als das Foto wäre. */
export function cropPixels(boxes: Box[], width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  const f = cropFraction(boxes);
  if (!f) return null;
  const left = Math.round(f[0] * width);
  const top = Math.round(f[1] * height);
  const w = Math.min(width - left, Math.round(f[2] * width));
  const h = Math.min(height - top, Math.round(f[3] * height));
  if (w < 40 || h < 20) return null;
  // Lohnt sich nicht, wenn fast das ganze Bild übrig bliebe
  if (w * h > 0.9 * width * height) return null;
  return { left, top, width: w, height: h };
}

/** Rechnet eine Box auf den zugeschnittenen Ausschnitt um. */
export function boxInCrop(b: Box, crop: Box): Box {
  return [(b[0] - crop[0]) / crop[2], (b[1] - crop[1]) / crop[3], b[2] / crop[2], b[3] / crop[3]];
}
