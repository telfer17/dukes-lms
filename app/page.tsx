import Image from "next/image";
import Link from "next/link";

// Deliberately static: no database access, so the app always boots while the
// Last Man Standing schema and screens are still being built.
export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-24 text-center">
      <Image
        src="/wellington.jpg"
        alt="Glasgow Wellington logo"
        width={160}
        height={160}
        priority
        className="mx-auto rounded-full"
      />
      <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
        Dukes — Last Man Standing
      </h1>
      <p className="mt-3 text-lg text-gray-600">Coming soon</p>
      <p className="mt-6">
        <Link
          href="/board"
          className="inline-block rounded-md border-2 border-blue-600 px-6 py-3 font-semibold text-blue-600 hover:bg-blue-50"
        >
          See who&apos;s still standing
        </Link>
      </p>
    </main>
  );
}
