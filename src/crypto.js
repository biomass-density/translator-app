/**
 * Generates a random 16-byte hex salt.
 * New rooms call this once and store the salt alongside the hash.
 */
export function generateSalt() {
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hash of (password + salt).
 * salt defaults to '' for backward compat with old rooms that have no salt stored.
 */
export async function hashPassword(password, salt = '') {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
