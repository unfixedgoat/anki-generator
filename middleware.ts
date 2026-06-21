import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/",
  "/privacy",
  "/terms",
  "/api/generate(.*)",
  "/api/generate/chunk(.*)",
  "/api/deck/start(.*)",
  "/api/finalize(.*)",
  "/api/embed-preset(.*)",
  "/api/stripe/webhook(.*)",
  "/api/stripe/checkout(.*)",
  "/api/me(.*)",
  "/api/whoami(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
