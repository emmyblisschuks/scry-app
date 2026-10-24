const PALETTE = [
  { bg: "#F3DCE3", text: "#7A2E3A" }, // mathematics / default wine
  { bg: "#E3DDF4", text: "#4C3A8A" }, // computer science - violet
  { bg: "#D9E6F2", text: "#2E5C7A" }, // physics - blue
  { bg: "#DCEFE0", text: "#2E7A4C" }, // chemistry - green
  { bg: "#F1E3C8", text: "#8A6B2E" }, // english - gold
  { bg: "#D8EDE9", text: "#2E7A6E" }, // biology - teal
];

export function colorForSubject(label: string | null | undefined) {
  if (!label) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
