import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/i18n/language-provider";
import { getCurrentLanguage } from "@/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoldPilot",
  description: "Phase 1 Mold Trial Tracker",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MoldPilot"
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4f91"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const language = await getCurrentLanguage();

  return (
    <html lang={language}>
      <body>
        <LanguageProvider initialLanguage={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
