// Trusted client-IP derivation, shared by every route that keys rate-limit,
// pro:, and credit: entries on an anonymous caller's IP. Deriving this in one
// place guarantees pro:${ip} / credit:${ip} are written and read under the same
// identifier on every route.
export function clientIp(req: Request): string {
  // Vercel overwrites these at the edge; client cannot seed the chain.
  // Parse rightmost consistently so a stacked/misconfigured proxy can't change the answer.
  const headers = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"];
  for (const h of headers) {
    const val = req.headers.get(h);
    if (val) {
      const ip = val.split(",").at(-1)?.trim();
      if (ip) return ip;
    }
  }
  return "anonymous";
}
