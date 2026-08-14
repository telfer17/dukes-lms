import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import NavBarGate from "@/components/NavBarGate";

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
// there is a custom domain. Neither set → local dev.
// Blank and malformed values are handled deliberately. `??` would accept the
// empty string that a Vercel dashboard field leaves behind when you clear it,
// and `new URL("")` throws at module scope — which takes down EVERY page, not
// just the share card. Verified: building with NEXT_PUBLIC_SITE_URL="" failed
// with "Invalid URL". A bad value costs you a wrong og:image, never the site.
const LOCAL_URL = "http://localhost:3001";

function resolveSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const candidate =
    configured || (vercel ? `https://${vercel}` : "") || LOCAL_URL;

  try {
    return new URL(candidate).toString();
  } catch {
    console.error(
      `Ignoring unusable site URL ${JSON.stringify(candidate)} — falling back to ${LOCAL_URL}. Set NEXT_PUBLIC_SITE_URL to an absolute url including https://`
    );
    return LOCAL_URL;
  }
}

const siteUrl = resolveSiteUrl();

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
