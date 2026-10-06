// Share link utilities.

// Alphabet excluding ambiguous characters: 0/O, 1/l/I
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generate a 6-character random alphanumeric slug.
 * Uses only unambiguous characters (no 0/O, 1/l/I).
 */
export function generateSlug(): string {
  let slug = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) {
    slug += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return slug;
}
