"use client";

import { useEffect, useState } from "react";
import { useAuth, useClerk, UserButton } from "@clerk/nextjs";

export default function AccountChip() {
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => setIsPro(!!data.isPro))
      .catch(() => {});
  }, [isSignedIn]);

  if (!isSignedIn) {
    return (
      <button
        onClick={() => openSignIn()}
        className="bg-[#c97f1a] text-white text-xs font-medium px-3 py-1.5 sm:px-4 sm:py-2 rounded-full shadow-md hover:bg-[#b8720f] transition-colors"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isPro && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-[#c97f1a] text-[#7a4f0d] bg-[#fef8ee]">
          Pro
        </span>
      )}
      <UserButton />
    </div>
  );
}
