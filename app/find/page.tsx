// Link recovery, not sign-up. Phone number -> that person's entries in the
// ACTIVE competition -> their private /pick/[entryId] links, so someone who
// lost their link gets it back without the organiser digging it out. Entry is
// organiser-mediated (an admin adds entrants against a competition), so this
// page deliberately offers no self-signup. The lookup itself runs server-side
// on the secret key in app/api/find-entry/route.ts.

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
        Lost your pick link? Enter the phone number you gave your club contact
        and we&apos;ll bring it back.
      </p>
      <FindEntryForm />
      </div>
    </main>
  );
}
