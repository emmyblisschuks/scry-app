import { createWorker } from "tesseract.js";

let workerPromise: ReturnType<typeof createWorker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export async function extractText(file: File): Promise<string> {
  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(file);
  return text.trim();
}
