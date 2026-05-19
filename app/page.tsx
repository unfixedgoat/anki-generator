"use client";

import { useState } from "react";
import DropZone, { type GenerationInfo } from "@/app/components/DropZone";
import SettingsRecommender from "@/app/components/SettingsRecommender";
import { VERSION } from "@/app/version";

export default function Home() {
  const [genInfo, setGenInfo] = useState<GenerationInfo | null>(null);

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Top bar */}
      <header className="w-full px-6 py-5 text-center border-b border-slate-200 bg-white">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
          Anki Generator
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload a document. Get flashcards.
        </p>
      </header>

      {/* Two-column body */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 w-full">
        {/* Left column — generator controls */}
        <div className="bg-white border-r border-slate-200 pl-16 pr-8 py-8 h-full overflow-y-auto">
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

      {/* Version badge */}
      <span className="fixed bottom-4 right-4 px-2.5 py-1 rounded-full bg-slate-800 text-white font-mono text-[10px] opacity-60 pointer-events-none select-none">
        {VERSION}
      </span>
    </div>
  );
}
