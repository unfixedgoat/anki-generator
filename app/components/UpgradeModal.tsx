"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Reason = "limit" | "characters";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reason: Reason;
  identifier: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const CONTENT: Record<Reason, { title: string; subtitle: string }> = {
  limit: {
    title: "You've used your 5 free decks this month",
    subtitle: "Upgrade for unlimited generations and higher document limits.",
  },
  characters: {
    title: "Your document exceeds the free limit",
    subtitle:
      "Free accounts support up to 50,000 characters (~25 pages of notes). Upgrade for full chapters and dense references, up to 300,000 characters.",
  },
};

export default function UpgradeModal({ isOpen, onClose, reason, identifier }: Props) {
  const { title, subtitle } = CONTENT[reason];
  const [loading, setLoading] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else {
      (triggerRef.current as HTMLElement | null)?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1400]/45"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-modal-title"
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl mx-auto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
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
                  aria-hidden="true"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>

              <div className="space-y-2">
                <p id="upgrade-modal-title" className="text-lg font-semibold text-[#1a2820] leading-snug">
                  {title}
                </p>
                <p className="text-sm text-slate-500 text-center leading-snug">{subtitle}</p>
              </div>

              <div className="flex flex-col gap-2 w-full">
                <motion.button
                  type="button"
                  onClick={() => checkout("pro_monthly")}
                  disabled={loading !== null}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="w-full px-6 py-3 rounded-full bg-[#c97f1a] text-white text-sm font-medium disabled:opacity-60 disabled:cursor-default"
                >
                  {loading === "pro_monthly" ? "Loading…" : "Upgrade to Pro — $6/mo"}
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => {
                    onClose();
                  }}
                  disabled={loading !== null}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="w-full px-6 py-3 rounded-full bg-white text-slate-600 border border-slate-200 text-sm font-medium disabled:opacity-40 disabled:cursor-default"
                >
                  Maybe later
                </motion.button>
              </div>

              <motion.button
                type="button"
                onClick={() => checkout("one_time")}
                disabled={loading !== null}
                whileHover={{ opacity: 0.7 }}
                transition={{ duration: 0.15 }}
                className="text-sm text-[#7a4f0d] underline underline-offset-2 disabled:cursor-default"
              >
                {loading === "one_time" ? "Loading…" : "Just need one deck? $2 one-time →"}
              </motion.button>

              <p className="text-[11px] text-slate-400 leading-snug">
                14-day money-back guarantee. Cancel subscriptions anytime.{" "}
                <a href="/terms" className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                  Terms &amp; refund policy
                </a>
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
