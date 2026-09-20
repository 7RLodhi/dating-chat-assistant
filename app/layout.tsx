import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Assist — Dating Reply Helper (v0)",
  description:
    "Paste a conversation, pick a tone and goal, get message suggestions. Validation prototype.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
