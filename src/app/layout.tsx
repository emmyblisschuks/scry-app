import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scry — Smarter studying, clearer answers",
  description:
    "Upload your study material and questions, get grounded answers pulled straight from your own notes.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
