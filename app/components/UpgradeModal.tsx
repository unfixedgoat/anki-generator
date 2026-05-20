"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Reason = "limit" | "characters";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reason: Reason;
  identifier: string;
}

const CONTENT: Record<Reason, { title: string; subtitle: string }> = {
  limit: {
    title: "You've used your 5 free decks this month",
    subtitle: "Upgrade for unlimited generations, all styles, and all density modes.",
  },
  characters: {
    title: "Your document exceeds the free limit",
    subtitle: "Free accounts support up to 50,000 characters (~10 dense pages). Upgrade for 300,000 character documents.",
  },
};

export default function UpgradeModal({ isOpen, onClose, reason, identifier }: Props) {
  const { title, subtitle } = CONTENT[reason];
  const [loading, setLoading] = useState<string | null>(null);

  async function checkout(plan: string) {
    setLoading(plan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, identifier }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLoading(null);
      }
    } catch {
      setLoading(null);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm bg-[#fffdf7] border border-[#f0c87a] rounded-2xl p-7 shadow-xl"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-11 h-11 rounded-full bg-[#c97f1a] flex items-center justify-center">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>

              <div className="space-y-2">
                <p className="text-[15px] font-semibold text-[#7a4f0d] font-serif leading-snug">
                  {title}
                </p>
                <p className="text-[13px] text-slate-500 leading-relaxed">{subtitle}</p>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => checkout("pro_monthly")}
                  disabled={loading !== null}
                  className="flex-1 py-2.5 rounded-full bg-[#c97f1a] text-white text-[12px] font-medium tracking-wide text-center hover:bg-[#b5711a] transition-colors duration-150 disabled:opacity-60 disabled:cursor-default"
                >
                  {loading === "pro_monthly" ? "Loading…" : "Upgrade to Pro — $6/mo"}
                </button>
                <button
                  onClick={onClose}
                  disabled={loading !== null}
                  className="flex-1 py-2.5 rounded-full border border-[#f0c87a] text-[#7a4f0d] text-[12px] font-medium hover:bg-[#fef8ee] transition-colors duration-150 disabled:opacity-40 disabled:cursor-default"
                >
                  Maybe later
                </button>
              </div>

              <button
                onClick={() => checkout("one_time")}
                disabled={loading !== null}
                className="text-[11px] text-[#7a4f0d] opacity-60 hover:opacity-100 transition-opacity duration-150 disabled:cursor-default"
              >
                {loading === "one_time" ? "Loading…" : "Just need one deck? $2 one-time →"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
