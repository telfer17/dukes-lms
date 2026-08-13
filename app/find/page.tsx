// TODO (before go-live): repoint this at the entries model.
// It still looks a person up by phone and shows their NAME only, which is a
// leftover from the World Cup predictor's single-entry world. What it should do
// is: phone -> that person's entries in the ACTIVE competition -> their private
// pick links (/pick/[entryId]), so someone who lost their link can recover it
// without the organiser digging it out. Entry itself is organiser-mediated now
// (admin adds entrants against a competition), so this page must never offer
// self-signup. Not rebuilt in Phase 5 — deliberately left as-is.

import Image from "next/image";
import Link from "next/link";
import FindEntryForm from "@/components/FindEntryForm";

export const metadata = {
  title: "Find my entry · Dukes — Last Man Standing",
};

export default function FindPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to home
      </Link>
      <div className="mt-2 text-center">
      <Image
        src="/wellington.jpg"
        alt="Glasgow Wellington logo"
        width={160}
        height={160}
        priority
        className="mx-auto rounded-full"
      />
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Find my entry</h1>
      <p className="mt-2 text-gray-600">
        Enter the phone number you gave your club contact to check your entry.
      </p>
      <FindEntryForm />
      </div>
    </main>
  );
}
