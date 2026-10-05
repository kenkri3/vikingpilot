import type { Metadata } from "next";
import "./globals.css";

// Vi bruker systemfonter med vilje. `next/font/google` henter fonter over nett
// under bygging, og systemet skal kunne bygges og demonstreres uten nettverk.
// Se docs/stoppkriterier.md, kriterium 3.

export const metadata: Metadata = {
  title: "VikingPilot",
  description: "Internt system for Vikingnet. Finner, kvalifiserer og forbereder.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nb">
      <body className="antialiased">{children}</body>
    </html>
  );
}
