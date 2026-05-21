"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth, useClerk, useUser, UserButton } from "@clerk/nextjs";
import posthog from "posthog-js";

export default function AccountChip() {
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();
  const { user } = useUser();
  const [apiIsPro, setApiIsPro] = useState(false);

  const isPro = user?.publicMetadata?.plan === "pro" || apiIsPro;

  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => setApiIsPro(!!data.isPro))
      .catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    if (isSignedIn && user?.id) {
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? undefined,
        plan: (user.publicMetadata?.plan as string) ?? "free",
      });
    }
  }, [isSignedIn, user?.id]);

  if (!isSignedIn) {
    return (
      <motion.button
        onClick={() => { posthog.capture("sign_in_clicked"); openSignIn(); }}
        className="bg-[#c97f1a] text-white text-xs font-medium px-3 py-1.5 sm:px-4 sm:py-2 rounded-full shadow-md hover:bg-[#b8720f] transition-colors"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        Sign in
      </motion.button>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <UserButton />
      {isPro && (
        <span className="text-[9px] font-semibold px-1 py-px rounded-full border border-[#c97f1a] text-[#7a4f0d] bg-[#fef8ee] uppercase tracking-tight leading-none mt-0.5">
          PRO
        </span>
      )}
    </div>
  );
}
