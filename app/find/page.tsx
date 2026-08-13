import Image from "next/image";
import Link from "next/link";
import FindEntryForm from "@/components/FindEntryForm";

export const metadata = {
  title: "Find my entry · Glasgow Wellington World Cup 2026 Predictor",
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
        Enter the phone number you signed up with to get back to your
        predictions.
      </p>
      <FindEntryForm />
      </div>
    </main>
  );
}
