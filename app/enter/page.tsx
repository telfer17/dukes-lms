import Image from "next/image";
import EnterForm from "@/components/EnterForm";

export default function EnterPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12 text-center">
      <Image
        src="/wellington.jpg"
        alt="Glasgow Wellington logo"
        width={160}
        height={160}
        priority
        className="mx-auto rounded-full"
      />
      <h1 className="mt-6 text-3xl font-bold tracking-tight">
        Enter the competition
      </h1>
      <EnterForm />
    </main>
  );
}
