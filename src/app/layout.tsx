import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel War",
  description: "Copycat of r/place, draw together wonderful pixel arts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="overflow-hidden">{children}</body>
    </html>
  );
}
