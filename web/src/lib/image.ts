// Fotos vor dem Hochladen im Browser aufbereiten: richtig drehen, auf max. 2400 px verkleinern
// und als JPEG speichern. Das macht den Upload im Mobilfunknetz schnell und wandelt
// iPhone-Fotos (HEIC) in ein Format um, das der Server lesen kann.

import type { Box } from './types';

export interface PreparedImage {
  blob: Blob;
  /** Objekt-URL zum Anzeigen (mit URL.revokeObjectURL freigeben) */
  url: string;
  image: HTMLImageElement;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Foto konnte nicht gelesen werden'));
    img.src = src;
  });
}

export async function prepareImage(file: File, maxSize = 2400): Promise<PreparedImage> {
  const src = URL.createObjectURL(file);
  try {
    // Browser drehen Fotos beim Laden selbst nach den EXIF-Angaben (image-orientation: from-image).
    const img = await loadImage(src);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Foto konnte nicht umgewandelt werden'))), 'image/jpeg', 0.88),
    );
    const url = URL.createObjectURL(blob);
    return { blob, url, image: await loadImage(url) };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Ausschnitt mit allen erkannten Ziffernbereichen (mit großzügigem Rand) als Bild-URL. */
export function cropToBoxes(img: HTMLImageElement, boxes: Box[]): string | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b[0]));
  const top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2]));
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  const padX = (right - left) * 0.25 + 0.03;
  const padY = (bottom - top) * 0.6 + 0.03;
  const x0 = Math.max(0, left - padX) * img.naturalWidth;
  const y0 = Math.max(0, top - padY) * img.naturalHeight;
  const x1 = Math.min(1, right + padX) * img.naturalWidth;
  const y1 = Math.min(1, bottom + padY) * img.naturalHeight;
  if (x1 - x0 < 20 || y1 - y0 < 20) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(x1 - x0);
  canvas.height = Math.round(y1 - y0);
  canvas.getContext('2d')!.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}
