"use client";

import Link from "next/link";
import { useAfterDeadline } from "@/components/useDeadline";

const navLinks = [
  { href: "/enter", label: "Enter", hideAfterDeadline: true },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/grid", label: "All picks" },
  { href: "/#how-it-works", label: "How it works" },
];

export default function NavLinks() {
  const closed = useAfterDeadline();
  return (
    <>
      {navLinks
        .filter((link) => !(closed && link.hideAfterDeadline))
        .map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="py-1 text-gray-600 hover:text-gray-900"
          >
            {link.label}
          </Link>
        ))}
    </>
  );
}
