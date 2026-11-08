// supabase-js's storage.upload() uses fetch under the hood, which gives no
// way to report upload progress — on a slow connection a multi-MB PDF can
// take a long time and the UI just sits on "Uploading…" with no feedback,
// which reads as frozen. This hits the same Storage REST endpoint directly
// with XMLHttpRequest so we can surface real percentage progress.
export function uploadWithProgress(
  bucket: string,
  path: string,
  file: File,
  accessToken: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  // Matches what @supabase/storage-js itself sends for a File/Blob body
  // (multipart form with the file under an empty field name plus a
  // cacheControl field) so the request looks the same to the storage API —
  // we're only replacing fetch with XHR to get progress events.
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "true");
    // Deliberately no content-type header: the browser sets the correct
    // multipart boundary for FormData bodies, and overriding it breaks parsing.

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 300)}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check your connection and try again."));
    xhr.send(form);
  });
}
