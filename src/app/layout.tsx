import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Inter is the workhorse: it's declared in globals.css as --font-sans but
// was never actually loaded anywhere, so every bit of body text has been
// silently rendering in the browser's default system-ui font. Fraunces is a
// warm, slightly editorial serif for headings — it fits the wine/cream
// theme already built into the CSS and reads as a deliberate choice rather
// than a template default.
// Named distinctly from the --font-sans/--font-serif tokens in globals.css
// (which build the Tailwind font-sans/font-serif utilities) so the two don't
// fight over the same CSS custom property; globals.css points at these.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"],
});

export const metadata: Metadata = {
  title: "Scry — Smarter studying, clearer answers",
  description:
    "Upload your study material and questions, get grounded answers pulled straight from your own notes.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
