import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import PostHogProvider from "./components/PostHogProvider";
import "./globals.css";

if (process.env.NODE_ENV === "development") {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.warn("[clerk] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set");
  }
  if (!process.env.CLERK_SECRET_KEY) {
    console.warn("[clerk] CLERK_SECRET_KEY is not set");
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "highyield.cards — AI Anki decks from any PDF",
  description:
    "Drop your syllabus. Get an Anki deck built around your exam date. Free AI-powered flashcard generator optimized for pre-med and serious learners.",
  metadataBase: new URL("https://highyield.cards"),
  openGraph: {
    title: "highyield.cards — AI Anki decks from any PDF",
    description:
      "Drop your syllabus. Get an Anki deck built around your exam date.",
    url: "https://highyield.cards",
    siteName: "highyield.cards",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "highyield.cards — AI Anki decks from any PDF",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "highyield.cards — AI Anki decks from any PDF",
    description:
      "Drop your syllabus. Get an Anki deck built around your exam date.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#c97f1a" />
      </head>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>
        <ClerkProvider>
          {children}
          <Script
            src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
            integrity="sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e"
            crossOrigin="anonymous"
            strategy="lazyOnload"
            id="pdfjs"
          />
          <Analytics />
        </ClerkProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
