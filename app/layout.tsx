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

export const metadata: Metadata = {
  title: "Dukes — Last Man Standing",
  description:
    "Glasgow Wellington's Last Man Standing competition. £10 to enter — half to the prize pot, half to the club.",
  openGraph: {
    title: "Dukes — Last Man Standing",
    description:
      "Glasgow Wellington's Last Man Standing competition. £10 to enter — half to the prize pot, half to the club.",
    siteName: "Dukes — Last Man Standing",
    type: "website",
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
