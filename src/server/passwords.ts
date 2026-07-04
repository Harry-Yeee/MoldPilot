import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const passwordHashVersion = "scrypt-v1";
const keyLength = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, keyLength).toString("hex");

  return `${passwordHashVersion}$${salt}$${key}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (storedHash == null || storedHash.length === 0) {
    return false;
  }

  const [version, salt, key] = storedHash.split("$");

  if (version !== passwordHashVersion || salt == null || key == null) {
    return false;
  }

  try {
    const expected = Buffer.from(key, "hex");
    const actual = scryptSync(password, salt, expected.length);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
