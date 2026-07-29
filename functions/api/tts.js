import { checkRateLimit } from './_rateLimit.js';

const VOICES = {
  English:   { languageCode: 'en-US', name: 'en-US-Neural2-F' },
  German:    { languageCode: 'de-DE', name: 'de-DE-Neural2-F' },
  Russian:   { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-E' },
  Polish:    { languageCode: 'pl-PL', name: 'pl-PL-Wavenet-E' },
  Ukrainian: { languageCode: 'uk-UA', name: 'uk-UA-Wavenet-A' },
};

// Messages are capped at 500 chars client-side, but translations routinely run
// longer than their source (German/Russian/Polish expand well past English), so
// the accepted length here must leave generous headroom above that cap.
// Google's own 5000-byte limit applies per synthesis request, and text is split
// into ~420-char chunks below, so a high cap here costs nothing and removes
// "text too long" as a way for a message to fail to be read aloud at all.
const MAX_TEXT_CHARS = 4000;
// Google TTS accepts far more than this, but shorter requests synthesize faster
// and let playback start sooner. Text above this is split on sentence bounds.
const CHUNK_TARGET_CHARS = 420;

/**
 * Splits text into chunks of at most `maxChars`, preferring sentence
 * boundaries, then clause boundaries, then whitespace. Never splits
 * mid-word — a word is only broken if it alone exceeds maxChars.
 */
function chunkText(text, maxChars = CHUNK_TARGET_CHARS) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  // Split into sentences, keeping their terminating punctuation.
  // Covers Latin (.!?) plus the ellipsis and CJK/other full stops.
  const sentences = trimmed.match(/[^.!?…。！？]+[.!?…。！？]*\s*/g) ?? [trimmed];

  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (current.length + sentence.length <= maxChars) {
      current += sentence;
      continue;
    }
    pushCurrent();

    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }

    // A single sentence longer than maxChars — break it on clause/word bounds.
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const slice = rest.slice(0, maxChars);
      // Prefer a clause break, then any whitespace, then a hard cut.
      let cut = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(' — '));
      if (cut < maxChars * 0.5) cut = slice.lastIndexOf(' ');
      if (cut <= 0) cut = maxChars;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    current = rest;
  }
  pushCurrent();

  return chunks.filter(Boolean);
}

async function synthesize(text, voice, speakingRate, apiKey, attempt = 0) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    // A long message is several chunks; without this one flaky chunk would
    // fail the whole message and it would never be read aloud.
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < 3) {
      await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
      return synthesize(text, voice, speakingRate, apiKey, attempt + 1);
    }
    const err = new Error(data.error?.message || 'Google TTS error');
    err.status = res.status;
    throw err;
  }
  return data.audioContent;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkRateLimit(request, 'tts'))) {
    return Response.json({ error: 'Too many requests — please slow down.' }, { status: 429 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { text, language, speed } = body;
  if (!text || !language) {
    return Response.json({ error: 'Missing text or language' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) {
    return Response.json(
      { error: `Text must be a string under ${MAX_TEXT_CHARS} characters.` },
      { status: 400 }
    );
  }
  const speakingRate = (typeof speed === 'number' && speed > 0)
    ? Math.min(Math.max(speed, 0.25), 4.0)
    : 1.0;

  const apiKey = env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GOOGLE_TTS_API_KEY is not set in Cloudflare environment variables.' }, { status: 500 });
  }

  const voice = VOICES[language] || VOICES.English;
  const chunks = chunkText(text);

  try {
    // Synthesize chunks in parallel; they are played back in order client-side.
    const audioSegments = await Promise.all(
      chunks.map(chunk => synthesize(chunk, voice, speakingRate, apiKey))
    );
    return Response.json({
      audioSegments,
      audioContent: audioSegments[0], // back-compat for older clients
      mimeType: 'audio/mpeg',
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
