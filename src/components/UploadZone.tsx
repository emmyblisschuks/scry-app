"use client";

import { useRef, useState } from "react";
import { FileText, Camera, X } from "lucide-react";

export default function UploadZone({
  kind,
  onFiles,
}: {
  kind: "material" | "questions";
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const isMaterial = kind === "material";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
        dragOver
          ? "border-wine bg-wine/5 scale-[1.01]"
          : "border-wine/30 bg-white"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple={!isMaterial}
        accept={isMaterial ? ".pdf,.docx" : "image/*"}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {isMaterial ? (
        <FileText className="text-wine" size={28} />
      ) : (
        <Camera className="text-wine" size={28} />
      )}
      <div>
        <p className="font-medium text-wine">Drag &amp; drop {isMaterial ? "files" : "images"} here</p>
        <p className="text-sm text-muted">or tap to upload</p>
      </div>
      <p className="text-xs text-muted">
        {isMaterial ? "PDF, DOCX" : "JPG, PNG, WEBP"} · Up to 10MB each
      </p>
    </div>
  );
}

export function FileChip({
  name,
  size,
  onRemove,
}: {
  name: string;
  size: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-wine/10 text-wine">
          <FileText size={16} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{name}</p>
          <p className="text-xs text-muted">{size}</p>
        </div>
      </div>
      <button onClick={onRemove} aria-label={`Remove ${name}`}>
        <X size={16} className="text-muted" />
      </button>
    </div>
  );
}
