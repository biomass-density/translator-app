import { checkRateLimit } from './_rateLimit.js';

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

  // Normalise: single `text` → array of one; `texts` → array as-is
  const textList = Array.isArray(texts) && texts.length > 0
    ? texts
    : (text ? [text] : null);

  if (!textList || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
    return Response.json(texts ? { translationSets: [] } : { translations: {} });
  }

  const ALLOWED_LANGUAGES = ['English', 'German', 'Russian', 'Polish', 'Ukrainian'];
  const MAX_TEXT_CHARS = 2000;
  const MAX_BATCH_TEXTS = 50;

  if (!targetLanguages.every(lang => ALLOWED_LANGUAGES.includes(lang))) {
    return Response.json({ error: 'Invalid target language.' }, { status: 400 });
  }
  if (textList.length > MAX_BATCH_TEXTS) {
    return Response.json({ error: 'Too many texts in one request.' }, { status: 400 });
  }
  if (textList.some(t => typeof t !== 'string' || t.length > MAX_TEXT_CHARS)) {
    return Response.json({ error: 'One or more texts exceed the 2000-character limit.' }, { status: 400 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY is not set in Cloudflare environment variables.' }, { status: 500 });
  }

  const isBatch = Array.isArray(texts) && texts.length > 0;

  const prompt = isBatch
    ? `You are a strict translation API. Return ONLY a valid JSON array — no markdown, no explanation.
Each element corresponds to one input text (same order and count as the input array).
Each element is an object mapping language names to their translations.
Translate literally and faithfully. Preserve exact wording as closely as the target language allows.
Target languages: ${targetLanguages.join(', ')}
Input texts (JSON array): ${JSON.stringify(textList)}`
    : `You are a strict translation API. Return ONLY a valid JSON object mapping language names to translations. No markdown, no explanation, no extra text. Translate literally and faithfully — do not paraphrase, summarize, or change the meaning. Preserve the exact wording and sentence structure as closely as the target language allows.
Text: "${textList[0]}"
Target languages: ${targetLanguages.join(', ')}`;

  let geminiRes, data;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    data = await geminiRes.json();
  } catch (err) {
    return Response.json({ error: `Network error calling Gemini: ${err.message}` }, { status: 500 });
  }

  if (!geminiRes.ok || !data.candidates) {
    const geminiError = data?.error?.message || JSON.stringify(data);
    return Response.json({ error: `Gemini API error: ${geminiError}` }, { status: 500 });
  }

  let raw = data.candidates[0].content.parts[0].text.trim();
  raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(raw);
    if (isBatch) {
      // Ensure we always return an array of the right length
      const sets = Array.isArray(parsed) ? parsed : [];
      return Response.json({ translationSets: sets });
    } else {
      return Response.json({ translations: parsed });
    }
  } catch {
    return Response.json({ error: `Could not parse Gemini response: ${raw}` }, { status: 500 });
  }
}
