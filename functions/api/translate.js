export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { text, targetLanguages } = body;

  if (!text || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
    return Response.json({ translations: {} });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Translation service not configured' }, { status: 500 });
  }

  const prompt = `You are a strict translation API. Return ONLY a valid JSON object mapping language names to translations. No markdown, no explanation, no extra text.
Text: "${text}"
Target languages: ${targetLanguages.join(', ')}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  const data = await geminiRes.json();

  if (!geminiRes.ok || !data.candidates) {
    return Response.json({ error: 'Translation request failed' }, { status: 500 });
  }

  let raw = data.candidates[0].content.parts[0].text.trim();
  raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return Response.json({ translations: JSON.parse(raw) });
  } catch {
    return Response.json({ error: 'Could not parse translation response' }, { status: 500 });
  }
}
