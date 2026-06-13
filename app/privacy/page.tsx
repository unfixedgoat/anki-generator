import type { Metadata } from "next";
import Link from "next/link";
import LegalHeader from "@/app/components/LegalHeader";

export const metadata: Metadata = {
  title: "Privacy Policy — highyield.cards",
  description: "How highyield.cards collects, uses, and protects your data.",
};

const LAST_UPDATED = "June 12, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f7f5f0]">
      <LegalHeader />
      <main className="flex-1 w-full max-w-xl mx-auto px-6 py-12 sm:py-16">
        <h1 className="font-serif text-3xl text-[#1a2820] mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-slate-700">
          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Who we are</h2>
            <p>
              highyield.cards (&ldquo;we,&rdquo; &ldquo;us&rdquo;) is a tool that turns documents you
              provide into Anki flashcard decks. This policy explains what data we handle when you
              use the service at <span className="font-mono text-sm">https://highyield.cards</span>,
              and the choices you have.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account information.</strong> If you sign in, our authentication provider{" "}
                <a href="https://clerk.com/legal/privacy" className="underline text-[#7a4f0d]" target="_blank" rel="noopener noreferrer">Clerk</a>{" "}
                collects your email address and, if you provide it, your name. We use this to
                identify your account and apply your plan limits.
              </li>
              <li>
                <strong>Documents you upload or paste.</strong> When you generate a deck, the text
                of your document is sent to our server and then transmitted to{" "}
                <a href="https://ai.google.dev/gemini-api/terms" className="underline text-[#7a4f0d]" target="_blank" rel="noopener noreferrer">Google&rsquo;s Gemini API</a>{" "}
                to produce the flashcards. We process your document in memory to build your deck
                and do not store its contents on our servers after your request completes.
                Google&rsquo;s handling of API inputs is governed by its Gemini API terms.
              </li>
              <li>
                <strong>Payment information.</strong> Purchases are processed by{" "}
                <a href="https://stripe.com/privacy" className="underline text-[#7a4f0d]" target="_blank" rel="noopener noreferrer">Stripe</a>.
                We never see or store your card number. We keep a record of your plan or purchase
                credits, tied to your account ID (or, for guest purchases, your IP address).
              </li>
              <li>
                <strong>IP address.</strong> We use your IP address to enforce free-tier rate
                limits and, if you are not signed in, to associate purchases and credits with you.
                These records are stored in Upstash Redis.
              </li>
              <li>
                <strong>Usage analytics.</strong> We use Vercel Analytics, a cookieless,
                privacy-focused analytics service that collects aggregated page-view data. It does
                not track you across sites or build a profile of you.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Cookies</h2>
            <p>
              We only use strictly necessary cookies: session cookies set by Clerk to keep you
              signed in, and cookies set by Stripe during checkout for payment security and fraud
              prevention. We do not use advertising or analytics cookies, which is why you
              don&rsquo;t see a cookie banner.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">How we use your data</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To generate your flashcard decks — the only thing we do with your documents.</li>
              <li>To operate accounts, plans, purchase credits, and rate limits.</li>
              <li>To process payments and apply refunds.</li>
              <li>To understand aggregate usage of the site (anonymous analytics).</li>
            </ul>
            <p className="mt-2">
              We do not sell your personal data, and we do not use your documents to train AI
              models.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Service providers</h2>
            <p>We share data only with the providers needed to run the service:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Clerk</strong> — authentication (email, name, session cookies).</li>
              <li><strong>Google (Gemini API)</strong> — document text, to generate flashcards.</li>
              <li><strong>Stripe</strong> — payment processing (email, payment details).</li>
              <li><strong>Vercel</strong> — hosting and anonymous analytics.</li>
              <li><strong>Upstash</strong> — storage of rate-limit, plan, and credit records.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Data retention</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Document text: processed in memory, not retained after your deck is generated.</li>
              <li>Generated decks: downloaded to your device; we do not keep a copy.</li>
              <li>Rate-limit records: expire automatically (typically within a month).</li>
              <li>Account and purchase records: kept while your account is active.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Your rights</h2>
            <p>
              Depending on where you live (including under GDPR and CCPA), you may have the right
              to access, correct, delete, or export your personal data, and to object to or
              restrict certain processing. To exercise any of these rights, contact us via the{" "}
              <a href="https://tally.so/r/b5YPre" className="underline text-[#7a4f0d]" target="_blank" rel="noopener noreferrer">contact form</a>{" "}
              and we will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Children</h2>
            <p>
              The service is not directed at children under 13, and we do not knowingly collect
              personal data from them.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Changes</h2>
            <p>
              If we make material changes to this policy, we will update the date above and, where
              required, notify you on the site.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl text-[#1a2820] mb-2">Contact</h2>
            <p>
              Questions about this policy? Reach us through the{" "}
              <a href="https://tally.so/r/b5YPre" className="underline text-[#7a4f0d]" target="_blank" rel="noopener noreferrer">contact form</a>.
            </p>
          </section>
        </div>

        <p className="mt-12 text-sm text-slate-500">
          See also our{" "}
          <Link href="/terms" className="text-[#7a4f0d] underline underline-offset-2">
            Terms of Service
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
