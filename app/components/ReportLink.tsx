// The footer link that opens the Argus "Report an issue" dialog (the widget script is loaded in app/layout.tsx).
// It ships hidden and the widget reveals it, so a blocked script leaves no dead link. The dot before it is drawn
// on the link itself (before:), so it appears and disappears with it. Same look as the Privacy and Terms links.
export default function ReportLink() {
  return (
    <button
      type="button"
      hidden
      data-argus-report-trigger
      className="py-1 text-[#7a4f0d] underline-offset-2 hover:underline transition-colors rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c97f1a] before:content-['·'] before:inline-block before:mr-3 before:text-slate-300 before:no-underline"
    >
      Report an issue
    </button>
  );
}
