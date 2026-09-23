import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import PwaBootstrap from "@/components/PwaBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Assist — Dating Reply Helper (v0)",
  description:
    "Paste a conversation, pick a tone and goal, get message suggestions. Validation prototype.",
  applicationName: "Chat Assist",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Chat Assist",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#db2777",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PwaBootstrap />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
