/**
 * Simple per-IP rate limiter using the Cloudflare Cache API.
 *
 * This is free — no WAF or KV required. The cache is local to each
 * Cloudflare data centre (PoP), so counts are not shared globally, but
 * it still stops sustained abuse from a single IP hitting the same PoP.
 * Writes are not atomic, so the actual limit may be slightly exceeded
 * under burst traffic — that is acceptable for a soft cost-protection guard.
 *
 * Limits: MAX_REQUESTS per WINDOW_MS per IP per PoP.
 */

const WINDOW_MS = 60_000;   // 1-minute sliding window
const MAX_REQUESTS = 30;    // requests allowed per window

export async function checkRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const window = Math.floor(Date.now() / WINDOW_MS);
  // Use a synthetic URL as the cache key (never actually fetched)
  const cacheKey = new Request(`https://babelchat-rate-limit/${ip}/${window}`);

  try {
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    const count = cached ? parseInt(await cached.text(), 10) : 0;

    if (count >= MAX_REQUESTS) return false; // blocked

    // Increment — not atomic but good enough for soft limiting
    await cache.put(
      cacheKey,
      new Response(String(count + 1), {
        headers: { 'Cache-Control': `max-age=${Math.ceil(WINDOW_MS / 1000)}` },
      })
    );
    return true; // allowed
  } catch {
    return true; // fail open — never block on rate-limiter errors
  }
}
