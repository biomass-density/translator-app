const VOICES = {
  English:   { languageCode: 'en-US', name: 'en-US-Neural2-F' },
  German:    { languageCode: 'de-DE', name: 'de-DE-Neural2-F' },
  Russian:   { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-E' },
  Polish:    { languageCode: 'pl-PL', name: 'pl-PL-Wavenet-E' },
  Ukrainian: { languageCode: 'uk-UA', name: 'uk-UA-Wavenet-A' },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { text, language, speed } = body;
  if (!text || !language) {
    return Response.json({ error: 'Missing text or language' }, { status: 400 });
  }
  const speakingRate = (typeof speed === 'number' && speed > 0)
    ? Math.min(Math.max(speed, 0.25), 4.0)
    : 1.0;

  const apiKey = env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GOOGLE_TTS_API_KEY is not set in Cloudflare environment variables.' }, { status: 500 });
  }

  const voice = VOICES[language] || VOICES.English;

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
    return Response.json(
      { error: data.error?.message || 'Google TTS error' },
      { status: res.status }
    );
  }

  // audioContent is already a base64 MP3 — return it directly
  return Response.json({ audioContent: data.audioContent, mimeType: 'audio/mpeg' });
}
