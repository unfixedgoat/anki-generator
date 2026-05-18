"use client";

import { useState } from "react";
import DropZone, { type GenerationInfo } from "@/app/components/DropZone";
import SettingsRecommender from "@/app/components/SettingsRecommender";
import { VERSION } from "@/app/version";

export default function Home() {
  const [genInfo, setGenInfo] = useState<GenerationInfo | null>(null);

  return (
    <main className="flex flex-col items-center bg-white px-6 py-16 gap-20">
      {/* Generator */}
      <div className="flex flex-col items-center gap-10 w-full">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
            Anki Generator
          </h1>
          <p className="text-sm text-slate-400 tracking-wide">
            Upload a document. Get flashcards.
          </p>
        </div>
        <DropZone onGenerated={setGenInfo} />
      </div>

      {/* Divider */}
      <div className="w-full max-w-xl flex items-center gap-4">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-[10px] uppercase tracking-widest text-slate-300 flex-shrink-0">
          Settings
        </span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* Settings Recommender */}
      <SettingsRecommender genInfo={genInfo} onNewGenInfo={setGenInfo} />

      <div className="h-8" />

      <span className="fixed bottom-4 right-4 px-2.5 py-1 rounded-full bg-slate-800 text-white font-mono text-[10px] opacity-60 pointer-events-none select-none">
        {VERSION}
      </span>
    </main>
  );
}
