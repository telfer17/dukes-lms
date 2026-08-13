import Image from "next/image";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <Image
            src="/wellington.jpg"
            alt="Glasgow Wellington logo"
            width={32}
            height={32}
            className="rounded-full"
          />
          World Cup 2026 Predictor
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <NavLinks />
          <a
            href="https://footyfees.co.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden shrink-0 opacity-70 hover:opacity-100 md:flex"
          >
            <Image
              src="/footyfees2.png"
              alt="Footy Fees"
              width={121}
              height={20}
              className="h-5 w-auto"
            />
          </a>
        </div>
      </nav>
    </header>
  );
}
