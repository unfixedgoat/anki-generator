import Link from "next/link";
import type { ReactNode } from "react";

// Single source of truth for inline links inside the legal prose. Internal
// hrefs render through next/link; anything starting with http(s) opens in a new
// tab with the right rel. One styled component keeps hover, focus, and the
// amber link color identical everywhere instead of re-typing classes per link.
const linkClass =
  "text-[#7a4f0d] underline decoration-[#7a4f0d]/40 underline-offset-2 " +
  "hover:decoration-[#7a4f0d] transition-[color,text-decoration-color] duration-150 " +
  "rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c97f1a]";

export default function LegalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (/^https?:/.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}
