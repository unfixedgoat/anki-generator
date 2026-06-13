import Link from "next/link";

// Bookends LegalHeader on the standalone /privacy and /terms pages, mirroring
// the app's legal footer so a visitor who lands here from search still feels
// inside the product. The current page is shown as plain text; the sibling
// links out, so the two pages always point at each other.
export default function LegalFooter({ current }: { current: "privacy" | "terms" }) {
  const linkClass =
    "text-[#7a4f0d] underline-offset-2 hover:underline rounded-[2px] " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c97f1a]";

  return (
    <footer className="flex-shrink-0 w-full border-t border-slate-200 bg-white">
      <div className="max-w-xl mx-auto px-6 py-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>© 2026 highyield.cards</span>
        <span aria-hidden="true" className="text-slate-300">·</span>
        {current === "privacy" ? (
          <span className="text-slate-400" aria-current="page">Privacy</span>
        ) : (
          <Link href="/privacy" className={linkClass}>Privacy</Link>
        )}
        <span aria-hidden="true" className="text-slate-300">·</span>
        {current === "terms" ? (
          <span className="text-slate-400" aria-current="page">Terms &amp; Refunds</span>
        ) : (
          <Link href="/terms" className={linkClass}>Terms &amp; Refunds</Link>
        )}
      </div>
    </footer>
  );
}
