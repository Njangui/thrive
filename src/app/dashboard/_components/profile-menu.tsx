"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { signOutAction } from "./sign-out-action";

export function ProfileMenu({ userName, userRole }: { userName: string; userRole: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink/5"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-light text-sm font-semibold text-primary-dark">
          {userName.slice(0, 1).toUpperCase()}
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium text-ink">{userName}</p>
          <p className="text-xs capitalize text-muted">{userRole}</p>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-ink/10 bg-white p-1.5 shadow-lg">
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-danger-light hover:text-danger"
            >
              <Icon name="logout" className="h-4 w-4" />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
