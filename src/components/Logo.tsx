import Image from "next/image";

// The Scry mark (open book + sparkles). The "Scry" wordmark is set in text
// next to it wherever the full lockup is needed.
export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      priority
      style={{ width: size, height: size }}
    />
  );
}
