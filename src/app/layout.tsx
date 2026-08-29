import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "WaSapp — Secure Messaging",
  description:
    "Private, end-to-end encrypted messaging with stories, voice notes, live location, calls and vanishing messages.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b141a",
};

const themeScript = `
try {
  var t = localStorage.getItem('wa_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-app text-main antialiased">{children}</body>
    </html>
  );
}
