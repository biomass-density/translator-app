const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

exports.translate = onCall({ secrets: ['GEMINI_API_KEY'] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { text, targetLanguages } = request.data;
  if (!text || !Array.isArray(targetLanguages) || targetLanguages.length === 0) {
    return { translations: {} };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are a strict translation API. Return ONLY a valid JSON object mapping language names to translations. No markdown, no explanation, no extra text.
Text: "${text}"
Target languages: ${targetLanguages.join(', ')}`;

  const result = await model.generateContent(prompt);
  let raw = result.response.text().trim();
  raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return { translations: JSON.parse(raw) };
  } catch {
    throw new HttpsError('internal', 'Translation parse failed.');
  }
});
