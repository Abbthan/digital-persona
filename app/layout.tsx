import type { Metadata } from "next";
import "./globals.css";
import { GlobalDock } from "@/front_end/components/GlobalDock";
import { ModalRoot } from "@/front_end/components/modals/ModalRoot";
import { PageTransition } from "@/front_end/components/PageTransition";
import { AppProviders } from "@/front_end/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "ECHO 回响",
  description:
    "Create AI personas of real people from photos, video, audio, chat history, and social media — then talk to them by text or real-time voice and video.",
};

// Sets data-theme on <html> synchronously, before first paint — without
// this, the theme would only be applied once ThemeProvider's effect runs
// after hydration, causing a visible flash of the wrong theme (e.g. a dark
// system preference briefly showing the light theme on load). Keep the
// storage key in sync with lib/theme-context.tsx's THEME_STORAGE_KEY.
const themeInitScript = `(function(){try{var s=localStorage.getItem('echo-theme-preference');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})();`;

// Uses the visitor's saved language first, then their system/browser language
// (Chinese or English), and falls back to English for every other locale.
// LocaleProvider later lets a signed-in account's saved choice take priority.
const languageInitScript = `(function(){try{var s=localStorage.getItem('echo-language-preference');var l=(s==='en'||s==='zh')?s:((navigator.language||'en').toLowerCase().indexOf('zh')===0?'zh':'en');document.documentElement.dataset.language=l;document.documentElement.lang=l==='zh'?'zh-CN':'en';}catch(e){}})();`;

// Always begin each page visit at the top. Browsers normally restore the prior
// scroll offset after a reload or a back/forward-cache return, which makes a
// freshly loaded page look as if it started partway down its content.
const scrollInitScript = `(function(){try{if('scrollRestoration' in history)history.scrollRestoration='manual';var r=function(){window.scrollTo(0,0)};r();window.addEventListener('pageshow',r)}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: languageInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: scrollInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppProviders>
          <GlobalDock />
          <PageTransition>{children}</PageTransition>
          <ModalRoot />
        </AppProviders>
      </body>
    </html>
  );
}
