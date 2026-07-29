"use client";

import { ClipboardEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type VerificationCodeInputProps = {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
  hasError?: boolean;
};

const normalizeCharacter = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);

// Styled as a focused macOS/iOS confirmation-code field: individual calm,
// evenly sized cells with a blue focus ring, while still behaving as one code.
export function VerificationCodeInput({
  length = 6,
  onComplete,
  disabled,
  hasError = false,
}: VerificationCodeInputProps) {
  const [characters, setCharacters] = useState<string[]>(() => Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function commit(next: string[]) {
    setCharacters(next);
    if (next.every(Boolean)) onComplete(next.join(""));
  }

  function updateCharacter(index: number, value: string) {
    const character = normalizeCharacter(value);
    const next = [...characters];
    next[index] = character;
    commit(next);
    if (character && index < length - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !characters[index] && index > 0) {
      const next = [...characters];
      next[index - 1] = "";
      setCharacters(next);
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < length - 1) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    const next = Array.from({ length }, (_, index) => pasted[index] ?? "");
    commit(next);
    inputRefs.current[Math.min(pasted.length, length) - 1]?.focus();
  }

  return (
    <div className="flex justify-center gap-2 sm:gap-sm" role="group" aria-label="Six-character confirmation code">
      {characters.map((character, index) => (
        <input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          value={character}
          onChange={(event) => updateCharacter(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          disabled={disabled}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Confirmation code character ${index + 1}`}
          aria-invalid={hasError || undefined}
          className={`h-14 w-11 rounded-sm border bg-canvas text-center font-display text-2xl font-semibold uppercase tracking-normal text-ink outline-none transition-[border-color,box-shadow,transform] duration-150 ease-out sm:h-16 sm:w-12 ${
            hasError ? "border-primary" : "border-hairline"
          } focus:border-primary-focus focus:ring-2 focus:ring-primary-focus/35 disabled:opacity-40`}
        />
      ))}
    </div>
  );
}
