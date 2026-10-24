export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M80 60 C80 60, 40 42, 20 56 L20 118 C40 104, 80 122, 80 122 C80 122, 120 104, 140 118 L140 56 C120 42, 80 60, 80 60 Z"
        fill="var(--color-wine)"
      />
      <path
        d="M80 38 L86 54 L102 48 L90 60 L102 72 L86 66 L80 82 L74 66 L58 72 L70 60 L58 48 L74 54 Z"
        fill="var(--color-wine)"
      />
    </svg>
  );
}
