/**
 * Simple per-IP rate limiter using the Cloudflare Cache API.
 *
 * This is free — no WAF or KV required. The cache is local to each
 * Cloudflare data centre (PoP), so counts are not shared globally, but
 * it still stops sustained abuse from a single IP hitting the same PoP.
 * Writes are not atomic, so the actual limit may be slightly exceeded
 * under burst traffic — that is acceptable for a soft cost-protection guard.
 *
 * IMPORTANT: budgets are scoped per endpoint. A group using this app is
 * typically in one room on one WiFi network, so every participant shares a
 * single public IP. Listening mode makes one TTS call per participant per
 * message, so a shared budget across endpoints would let listeners starve
 * the sender's translation calls — which surfaces as messages being read
 * aloud untranslated. Keep TTS well above translate for that reason.
 */

const WINDOW_MS = 60_000;   // 1-minute window

export const RATE_LIMITS = {
  translate: 120,  // senders + retroactive batches
  tts:       300,  // one call per listener per message — scales with room size
};

export async function checkRateLimit(request, scope = 'default') {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const window = Math.floor(Date.now() / WINDOW_MS);
  const max = RATE_LIMITS[scope] ?? 60;
  // Use a synthetic URL as the cache key (never actually fetched).
  // Scope is part of the key so endpoints get independent budgets.
  const cacheKey = new Request(`https://babelchat-rate-limit/${scope}/${ip}/${window}`);

  try {
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    const count = cached ? parseInt(await cached.text(), 10) : 0;

    if (count >= max) return false; // blocked

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
