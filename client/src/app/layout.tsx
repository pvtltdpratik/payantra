import type { Metadata } from "next";
import localFont from "next/font/local";
import { MOTION_BOOT_SCRIPT } from "@/lib/motion";
import "./globals.css";

/**
 * Self-hosted, Latin only (both families are SIL OFL 1.1). With next/font/google every unicode subset is declared,
 * and the rupee sign (U+20B9) sits in Inter's "latin-ext" file, so the browser downloaded an extra 85 kB just to
 * draw "₹" in the first screen. Declaring only Latin means the rupee sign falls back to the device's own font for
 * free, and the two files total 86 kB. Both are variable fonts: one file covers every weight.
 */
const serif = localFont({
  src: "./fonts/cormorant-garamond-latin.woff2",
  variable: "--font-cormorant",
  weight: "300 700",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const sans = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  // Needed to resolve absolute Open Graph / canonical URLs. Set to the public https origin in production.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Payantra — Indian Fashion, Reimagined",
    template: "%s · Payantra",
  },
  description:
    "Sarees, kurtas, lehengas and Indo-western wear for men and women. Premium Indian fashion, delivered across India.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the boot script below sets data-motion / data-hero on <html> before React hydrates.
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
