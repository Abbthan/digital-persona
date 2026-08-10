import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * Password hashing intentionally lives outside the common auth/session
 * module. Most authenticated API requests only need getCurrentUser(); keeping
 * bcrypt in that shared module made its CPU-heavy implementation part of the
 * ordinary dashboard/session dependency graph as well.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
