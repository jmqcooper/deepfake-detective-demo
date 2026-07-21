import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Nunito, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display: characterful, slightly editorial — museum signage, not a SaaS dashboard.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

// Body: rounded and warm, comfortable for an 8-year-old reading Dutch.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

// Mono: case numbers and evidence labels. Tabular by nature.
const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "De Deepfake Detective Academie",
  description:
    "Interactieve museumdemo over spraak-AI en deepfakes — INDEEP / UvA",
};

export const viewport: Viewport = {
  themeColor: "#05070f",
  // Kiosk tablets: a stray pinch must not wreck the layout mid-demo.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
