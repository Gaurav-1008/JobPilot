import type { Metadata } from "next";
import { Poppins, IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

/*
 * The Elegant Luxury pairing: Poppins for interface text, Libre Baskerville for
 * display, IBM Plex Mono for the monospaced slots (email bodies, provider ids,
 * pasted JDs).
 *
 * This replaces Geist, which was chosen here for costing two variable files and
 * being unobjectionable. Poppins is neither — it is a geometric sans with
 * near-circular bowls and a wide set, which is most of why the theme reads as
 * warm rather than as a dashboard, and it ships as static instances.
 *
 * WEIGHTS ARE ENUMERATED, NOT ASSUMED. next/font fetches one file per weight
 * declared and synthesises anything missing, and synthesised bold on a
 * geometric face smears the counters. The app uses exactly four: 400 default,
 * 500 for labels (55 call sites), 600 for headings (24), 700 once. The serif
 * loads regular alone — it is used at display sizes where Baskerville's own
 * contrast is the weight, and a second file would buy one heading nothing.
 */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const baskerville = Libre_Baskerville({
  variable: "--font-baskerville",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobPilot",
  description:
    "Find roles, tailor truthfully, and write outreach you can verify line by line.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${baskerville.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {/*
           * Skip link. The header carries seven destinations, and without this
           * a keyboard user tabs through all of them on every single page
           * before reaching the content — on the jobs board that is seven tabs
           * before the first row.
           *
           * Visually hidden until focused rather than hidden outright:
           * `display:none` would take it out of the focus order and it would do
           * nothing at all.
           */}
          <a
            href="#main"
            className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center"
          >
            Skip to content
          </a>
          <AppHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <AppFooter />
        </Providers>
      </body>
    </html>
  );
}
