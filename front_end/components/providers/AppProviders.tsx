"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/front_end/state/auth-context";
import { ModalProvider } from "@/front_end/state/modal-context";
import { ThemeProvider } from "@/front_end/state/theme-context";
import { LocaleProvider } from "@/front_end/state/locale-context";
import { LocaleTextTranslator } from "@/front_end/components/providers/LocaleTextTranslator";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LocaleProvider>
          <LocaleTextTranslator />
          <ModalProvider>{children}</ModalProvider>
        </LocaleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
