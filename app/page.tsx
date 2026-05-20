"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import DropZone, { type GenerationInfo } from "@/app/components/DropZone";
import SettingsRecommender from "@/app/components/SettingsRecommender";

export default function Home() {
  const [genInfo, setGenInfo] = useState<GenerationInfo | null>(null);

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Top bar */}
      <header className="w-full px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="highyield.cards" style={{height: '28px', width: 'auto'}} />
          <span className="font-serif text-sm font-medium text-[#1a2820]">highyield<span className="text-[#c97f1a]">.cards</span></span>
        </div>
        <p className="text-sm text-slate-400 mt-1 font-serif italic">
          Upload a document. Get flashcards.
        </p>
      </header>

      {/* Two-column body */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 w-full">
        {/* Left column — generator controls */}
        <div className="bg-white border-r border-slate-200 px-8 py-8 h-full overflow-y-auto">
          <div className="max-w-md mx-auto h-full">
            <DropZone onGenerated={setGenInfo} />
          </div>
        </div>

        {/* Right column — settings recommender */}
        <div className="bg-[#f7f5f0] px-6 py-5 h-full overflow-hidden">
          <div className="max-w-md mx-auto">
            <SettingsRecommender genInfo={genInfo} onNewGenInfo={setGenInfo} />
          </div>
        </div>
      </div>

      {/* Feedback button */}
      <motion.div
        className="fixed bottom-6 right-6 z-50"
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8, delay: 0.5 }}
      >
        <motion.button
          onClick={() => window.open('https://tally.so/r/b5YPre', '_blank')}
          className="bg-[#c97f1a] text-white text-xs font-medium px-4 py-2 rounded-full shadow-md hover:bg-[#b8720f] transition-colors"
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
