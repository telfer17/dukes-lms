"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  constantTimeEqual,
  sessionToken,
} from "@/lib/admin-auth";

type LoginState = { error: string } | null;

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const password = formData.get("password");
  const adminPassword = process.env.ADMIN_PASSWORD;

  // Compare hashes rather than raw strings: equal-length inputs keep the
  // constant-time comparison honest even when password lengths differ.
  const valid =
    typeof password === "string" &&
    !!adminPassword &&
    constantTimeEqual(
      await sessionToken(password),
      await sessionToken(adminPassword)
    );

  if (!valid) {
    return { error: "Incorrect password" };
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, await sessionToken(password as string), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}
