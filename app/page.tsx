import DropZone from "@/app/components/DropZone";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <div className="flex flex-col items-center gap-10 w-full">
        {/* Wordmark */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
            Anki Generator
          </h1>
          <p className="text-sm text-slate-400 tracking-wide">
            Upload a document. Get flashcards.
          </p>
        </div>

        <DropZone />

        <p className="text-[11px] text-slate-300 tracking-widest uppercase">
          PDF · No size limit
        </p>
      </div>
    </main>
  );
}
