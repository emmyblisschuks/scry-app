"use client";

import { useRef } from "react";
import { X, CheckCircle2, AlertTriangle } from "lucide-react";
import { QuestionImage } from "@/lib/types";

export default function QuestionThumb({
  image,
  onRemove,
  onReplace,
}: {
  image: QuestionImage;
  onRemove: () => void;
  onReplace: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border-2 ${
        image.isBlurry ? "border-warn" : "border-transparent"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.previewUrl}
        alt="Question screenshot"
        className="h-full w-full object-cover"
      />

      <button
        onClick={onRemove}
        aria-label="Remove image"
        className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-white"
      >
        <X size={12} />
      </button>

      <div className="absolute right-1.5 top-1.5">
        {image.isBlurry ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-warn text-white">
            <AlertTriangle size={12} />
          </span>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok text-white">
            <CheckCircle2 size={12} />
          </span>
        )}
      </div>

      {image.isBlurry && (
        <button
          onClick={() => inputRef.current?.click()}
          className="absolute bottom-0 left-0 right-0 bg-wine-dark py-1 text-[10px] font-medium text-white"
        >
          Replace
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onReplace(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
