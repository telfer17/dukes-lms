"use client";

import { useTransition } from "react";
import { deleteParticipant, setPaid } from "@/app/admin/entrants/actions";

type Props = {
  id: string;
  name: string;
  phone: string | null;
  paid: boolean;
};

export default function EntrantRow({ id, name, phone, paid }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-gray-500">{phone}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={paid}
            disabled={pending}
            onChange={() => startTransition(() => setPaid(id, !paid))}
          />
          Paid
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete ${name}?`)) {
              startTransition(() => deleteParticipant(id));
            }
          }}
          className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
