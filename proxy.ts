import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidSession } from "@/lib/admin-auth";

// Next 16 renamed `middleware` to `proxy` — same role: gate /admin (and
// everything under it, except the login page itself) behind a valid session.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login" || pathname === "/admin/login/") {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(ADMIN_COOKIE)?.value;
  if (await isValidSession(cookieValue)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin/:path*"],
};
