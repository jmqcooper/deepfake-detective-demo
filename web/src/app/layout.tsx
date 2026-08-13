import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Display: characterful, slightly editorial — museum signage, not a SaaS dashboard.
const bricolage = localFont({
  src: "./fonts/BricolageGrotesque-variable.ttf",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
});

// Body: rounded and warm, comfortable for an 8-year-old reading Dutch.
const nunito = localFont({
  src: "./fonts/Nunito-variable.ttf",
  variable: "--font-nunito",
  weight: "200 1000",
  display: "swap",
});

// Mono: case numbers and evidence labels. Tabular by nature.
const mono = localFont({
  src: "./fonts/JetBrainsMono-variable.ttf",
  variable: "--font-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "De Deepfake Detective Academie",
  description:
    "Interactieve museumdemo over spraak-AI en deepfakes — INDEEP / UvA",
};

export const viewport: Viewport = {
  themeColor: "#05070f",
  width: "device-width",
  initialScale: 1,
  /**
   * Zoom stays on. It was disabled to stop a stray pinch wrecking a kiosk
   * layout mid-demo — but the layout is now built to survive being zoomed, and
   * blocking it locks out every visitor who needs to magnify the spectrogram
   * or the Dutch copy. That is a much larger group than the one that pinches
   * by accident, and the accidental pinch is one pinch away from being undone.
   */
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${bricolage.variable} ${nunito.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
