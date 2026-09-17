import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegistration } from "./pwa-registration";

export const metadata: Metadata = {
  metadataBase: new URL("https://proconect-orange-interventii.vladimir-carlan.workers.dev"),
  title: "Proconect Orange Intervenții",
  description:
    "Management, execuție și documentare pentru intervențiile Orange.",
  applicationName: "Proconect Orange Intervenții",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Proconect Orange Intervenții",
    description:
      "Management, execuție și documentare pentru intervențiile Orange.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Proconect Orange — Intervenții documentate complet.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proconect Orange Intervenții",
    description:
      "Management, execuție și documentare pentru intervențiile Orange.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/pwa-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/pwa-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#ff7900",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className="antialiased">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
