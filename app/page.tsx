"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import DropZone, { type GenerationInfo } from "@/app/components/DropZone";
import SettingsRecommender from "@/app/components/SettingsRecommender";
import AccountChip from "@/app/components/AccountChip";
import { APP_VERSION } from "@/app/version";

export default function Home() {
  const [genInfo, setGenInfo] = useState<GenerationInfo | null>(null);

  return (
    <div className="flex flex-col min-h-screen md:h-screen md:overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 w-full px-6 py-5 border-b border-slate-200 bg-white grid grid-cols-[auto_1fr_auto] items-center">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="highyield.cards" style={{height: '28px', width: 'auto'}} />
          <span className="font-serif text-sm font-medium text-[#1a2820]">highyield<span className="text-[#c97f1a]">.cards</span></span>
          <span className="text-[10px] text-slate-300 font-mono ml-1">{APP_VERSION}</span>
        </div>
        <p className="hidden sm:block text-center text-sm text-slate-400 font-serif italic pointer-events-none">
          Drop your syllabus. Get an Anki deck built around your exam date.
        </p>
        <AccountChip />
      </header>

      {/* Body: stacked on mobile, side-by-side on desktop */}
      <div className="flex flex-col md:grid md:grid-cols-2 flex-1 md:overflow-hidden">
        {/* Generator */}
        <div className="bg-white md:border-r border-slate-200 px-4 py-6 md:px-8 md:py-8 md:h-full md:overflow-y-auto">
          <div className="max-w-md mx-auto md:h-full">
            <DropZone onGenerated={setGenInfo} />
          </div>
        </div>

        {/* Settings Recommender */}
        <div className="bg-[#f7f5f0] border-t md:border-t-0 border-slate-200 px-4 py-6 md:px-8 md:py-5 md:h-full md:overflow-y-auto">
          <div className="max-w-md mx-auto">
            <SettingsRecommender genInfo={genInfo} onNewGenInfo={setGenInfo} />
          </div>
        </div>
      </div>

      {/* Mobile feedback link — only visible below sm breakpoint */}
      <div className="block sm:hidden text-center py-4">
        <button
          onClick={() => window.open('https://tally.so/r/b5YPre', '_blank')}
          className="text-xs text-[#7a4f0d] underline px-6 py-3"
        >
          Leave feedback
        </button>
      </div>

      {/* Feedback button — hidden on mobile, visible sm+ */}
      <motion.div
        className="hidden sm:flex fixed bottom-6 right-6 z-50"
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8, delay: 0.5 }}
      >
        <motion.button
          onClick={() => window.open('https://tally.so/r/b5YPre', '_blank')}
          className="bg-[#c97f1a] text-white text-xs font-medium px-3 py-1.5 sm:px-4 sm:py-2 rounded-full shadow-md hover:bg-[#b8720f] transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          Feedback
        </motion.button>
      </motion.div>
    </div>
  );
}
