// Trusted client-IP derivation, shared by every route that keys rate-limit,
// pro:, and credit: entries on an anonymous caller's IP. Deriving this in one
// place guarantees pro:${ip} / credit:${ip} are written and read under the same
// identifier on every route.
export function clientIp(req: Request): string {
  // Vercel overwrites these at the edge; client cannot seed the chain.
  // Production parses rightmost so a stacked/misconfigured proxy can't change
  // the answer. Dev parses leftmost: the dev server appends its own hop (::1),
  // so rightmost would collapse every local test identity into one bucket and
  // verify-caps could never exercise the pro:/credit: tiers it seeds.
  const dev = process.env.NODE_ENV !== "production";
  const headers = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"];
  for (const h of headers) {
    const val = req.headers.get(h);
    if (val) {
      const parts = val.split(",");
      const ip = (dev ? parts[0] : parts.at(-1))?.trim();
      if (ip) return ip;
    }
  }
  return "anonymous";
}
