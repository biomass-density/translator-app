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
    return Response.json({ error: 'GEMINI_API_KEY is not set in Cloudflare environment variables.' }, { status: 500 });
  }

  const prompt = `You are a strict translation API. Return ONLY a valid JSON object mapping language names to translations. No markdown, no explanation, no extra text.
Text: "${text}"
Target languages: ${targetLanguages.join(', ')}`;

  let geminiRes, data;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
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
    // Pass the real Gemini error back so it's visible in logs
    const geminiError = data?.error?.message || JSON.stringify(data);
    return Response.json({ error: `Gemini API error: ${geminiError}` }, { status: 500 });
  }

  let raw = data.candidates[0].content.parts[0].text.trim();
  raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return Response.json({ translations: JSON.parse(raw) });
  } catch {
    return Response.json({ error: `Could not parse Gemini response: ${raw}` }, { status: 500 });
  }
}
