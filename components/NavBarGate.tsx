"use client";

import { usePathname } from "next/navigation";

/** Hides the public NavBar inside the admin area. */
export default function NavBarGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return <>{children}</>;
}
