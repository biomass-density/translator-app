import { checkRateLimit } from './_rateLimit.js';

// Maps the app's language names to ISO 639-1 codes used by Google Cloud Translation
const LANGUAGE_CODES = {
  English:   'en',
  German:    'de',
  Russian:   'ru',
  Polish:    'pl',
  Ukrainian: 'uk',
};

const ALLOWED_LANGUAGES = Object.keys(LANGUAGE_CODES);
const MAX_TEXT_CHARS = 2000;
const MAX_BATCH_TEXTS = 50;

/**
 * Calls the Google Cloud Translation API v2.
 * Supports multiple source texts in one call (all translated to the same target language).
 * Returns an array of translated strings in the same order as `texts`.
 */
async function googleTranslate(texts, targetLangCode, apiKey) {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target: targetLangCode, format: 'text' }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Translate error');
  return data.data.translations.map(t => t.translatedText);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkRateLimit(request))) {
    return Response.json({ error: 'Too many requests — please slow down.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { text, texts, targetLanguages } = body;

  // Normalise: single `text` → one-element array; `texts` array → as-is
  const textList = Array.isArray(texts) && texts.length > 0
    ? texts
    : (text ? [text] : null);

  if (!textList || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
    return Response.json(texts ? { translationSets: [] } : { translations: {} });
  }

  if (!targetLanguages.every(lang => ALLOWED_LANGUAGES.includes(lang))) {
    return Response.json({ error: 'Invalid target language.' }, { status: 400 });
  }
  if (textList.length > MAX_BATCH_TEXTS) {
    return Response.json({ error: 'Too many texts in one request.' }, { status: 400 });
  }
  if (textList.some(t => typeof t !== 'string' || t.length > MAX_TEXT_CHARS)) {
    return Response.json({ error: 'One or more texts exceed the 2000-character limit.' }, { status: 400 });
  }

  const apiKey = env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GOOGLE_TRANSLATE_API_KEY is not set in Cloudflare environment variables.' },
      { status: 500 }
    );
  }

  const isBatch = Array.isArray(texts) && texts.length > 0;

  try {
    if (isBatch) {
      // Retroactive translation: many texts → one language.
      // Google Translate accepts multiple `q` values in a single API call — fast.
      const langCode = LANGUAGE_CODES[targetLanguages[0]];
      const translated = await googleTranslate(textList, langCode, apiKey);
      const translationSets = translated.map(t => ({ [targetLanguages[0]]: t }));
      return Response.json({ translationSets });
    } else {
      // Real-time translation: one text → multiple languages.
      // Fire one API call per language in parallel — still fast (~150ms each).
      const results = await Promise.all(
        targetLanguages.map(async lang => {
          const langCode = LANGUAGE_CODES[lang];
          const [translated] = await googleTranslate(textList, langCode, apiKey);
          return [lang, translated];
        })
      );
      return Response.json({ translations: Object.fromEntries(results) });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
