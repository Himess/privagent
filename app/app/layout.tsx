import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "PrivAgent V4 Demo",
  description: "Private AI Agent Payments on Base",
  other: {
    "base:app_id": "69ab34f349645da9eb55ad6f",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-privagent-dark antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
