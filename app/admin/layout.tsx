import { logout } from "@/app/admin/login/actions";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-gray-200 bg-gray-50">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <span className="font-bold tracking-tight">
            Admin · Glasgow Wellington
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Logout
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
