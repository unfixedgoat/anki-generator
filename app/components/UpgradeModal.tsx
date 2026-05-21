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
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl mx-auto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-10 h-10 rounded-full bg-[#fef8ee] border border-[#f0c87a] flex items-center justify-center">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[#c97f1a]"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>

              <div className="space-y-2">
                <p className="text-lg font-semibold text-[#1a2820] leading-snug">
                  {title}
                </p>
                <p className="text-sm text-slate-500 text-center leading-snug">{subtitle}</p>
              </div>

              <div className="flex flex-col gap-2 w-full">
                <motion.button
                  onClick={() => checkout("pro_monthly")}
                  disabled={loading !== null}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="w-full px-6 py-2.5 rounded-full bg-[#c97f1a] text-white text-sm font-medium disabled:opacity-60 disabled:cursor-default"
                >
                  {loading === "pro_monthly" ? "Loading…" : "Upgrade to Pro — $6/mo"}
                </motion.button>
                <motion.button
                  onClick={onClose}
                  disabled={loading !== null}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="w-full px-6 py-2.5 rounded-full bg-white text-slate-600 border border-slate-200 text-sm font-medium disabled:opacity-40 disabled:cursor-default"
                >
                  Maybe later
                </motion.button>
              </div>

              <motion.button
                onClick={() => checkout("one_time")}
                disabled={loading !== null}
                whileHover={{ opacity: 0.7 }}
                transition={{ duration: 0.15 }}
                className="text-sm text-[#7a4f0d] underline underline-offset-2 disabled:cursor-default"
              >
                {loading === "one_time" ? "Loading…" : "Just need one deck? $2 one-time →"}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
