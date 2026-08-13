import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://world-cup-predictor-flax.vercel.app"),
  title: "Glasgow Wellington · World Cup 2026 Predictor",
  description:
    "Predict all 72 World Cup 2026 group-stage scores. £10 to enter — half to the prize pot, half to the club.",
  openGraph: {
    title: "Glasgow Wellington · World Cup 2026 Predictor",
    description:
      "Predict all 72 World Cup 2026 group-stage scores. £10 to enter — half to the prize pot, half to the club.",
    url: "/",
    siteName: "Glasgow Wellington · World Cup 2026 Predictor",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Glasgow Wellington · World Cup 2026 Predictor",
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
