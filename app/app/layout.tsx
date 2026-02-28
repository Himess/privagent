import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhostPay V4 Demo",
  description: "Private AI Agent Payments on Base",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ghost-dark antialiased">
        {children}
      </body>
    </html>
  );
}
