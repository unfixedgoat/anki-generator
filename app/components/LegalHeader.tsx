import Link from "next/link";

// Slim branded header for the standalone legal pages. Mirrors the app's
// top-bar wordmark so visitors who land directly on /privacy or /terms from
// search are oriented and have a clear path back into the product.
export default function LegalHeader() {
  return (
    <header className="flex-shrink-0 w-full border-b border-slate-200 bg-white">
      <div className="max-w-xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.png" alt="" aria-hidden="true" style={{ height: "24px", width: "auto" }} />
          <span className="font-serif text-sm font-medium text-[#1a2820]">
            highyield<span className="text-[#c97f1a]">.cards</span>
          </span>
        </Link>
        <Link
          href="/"
          className="text-xs text-[#7a4f0d] underline-offset-2 hover:underline"
        >
          Back to app
        </Link>
      </div>
    </header>
  );
}
