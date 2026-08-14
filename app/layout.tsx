import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import NavBarGate from "@/components/NavBarGate";
import { resolveSiteUrl } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The share card needs ABSOLUTE urls, so metadataBase has to know where the
// app is served from. Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every
// deployment (no configuration needed); NEXT_PUBLIC_SITE_URL overrides it once
// there is a custom domain. Neither set → local dev. Blank, malformed and
// non-http values all fall back rather than throwing — see lib/site-url.ts,
// which is where the reasoning and the tests live. The process.env reads stay
// here, spelled out, so Next can still inline NEXT_PUBLIC_SITE_URL.
const siteUrl = resolveSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL
);

const DESCRIPTION =
  "Glasgow Wellington's Last Man Standing competition. Pick one Premier League team a round — win and you're through, draw or lose and you're out. £10 to enter, half to the prize pot and half to the club.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Dukes — Last Man Standing",
  description: DESCRIPTION,
  openGraph: {
    title: "Dukes — Last Man Standing",
    description: DESCRIPTION,
    url: "/",
    siteName: "Dukes — Last Man Standing",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Dukes — Last Man Standing, Glasgow Wellington FC",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBarGate>
          <NavBar />
        </NavBarGate>
        {children}
      </body>
    </html>
  );
}
