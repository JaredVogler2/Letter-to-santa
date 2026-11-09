import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Letter to Santa | Make a magical wish list",
  description: "Make a beautiful printable letter to Santa. Paste gift links, add wishes, and give each gift a scannable QR code.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
