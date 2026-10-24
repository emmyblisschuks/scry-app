/**
 * Client-side blur detection using the Laplacian variance method.
 * Low variance in the edge-detected image = few sharp edges = likely blurry.
 * Threshold tuned empirically; adjust BLUR_THRESHOLD after testing against
 * real phone screenshots.
 */

const BLUR_THRESHOLD = 120;
const SAMPLE_SIZE = 300; // downscale for speed, blur detection doesn't need full res

export async function detectBlur(file: File): Promise<boolean> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 3x3 Laplacian kernel: [0,1,0 / 1,-4,1 / 0,1,0]
  const laplacian: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const value =
        gray[idx - w] +
        gray[idx + w] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      laplacian.push(value);
    }
  }

  if (laplacian.length === 0) return false;

  const mean = laplacian.reduce((a, b) => a + b, 0) / laplacian.length;
  const variance =
    laplacian.reduce((sum, v) => sum + (v - mean) ** 2, 0) / laplacian.length;

  return variance < BLUR_THRESHOLD;
}
