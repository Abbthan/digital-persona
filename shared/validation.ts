// Pure, dependency-free format checks — safe to import from client
// components (unlike lib/auth.ts, which pulls in bcryptjs/db). lib/auth.ts's
// validateUsername/validateEmail delegate to these so format rules live in
// exactly one place.

export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function usernameFormatError(username: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return "Username must be 3-20 characters: letters, numbers, underscore only.";
  }
  return null;
}

export function emailFormatError(email: string): string | null {
  if (!isValidEmailFormat(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function passwordFormatError(password: string): string | null {
  return password.length < 8 ? "Use a password with at least 8 characters." : null;
}
