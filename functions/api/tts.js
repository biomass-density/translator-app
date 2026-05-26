// Gemini 2.0 Flash audio output — uses the same GEMINI_API_KEY as translation
// Returns PCM audio wrapped in a WAV header so browsers can play it directly

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { text, language } = body;
  if (!text || !language) {
    return Response.json({ error: 'Missing text or language' }, { status: 400 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Aoede' },
              },
            },
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return Response.json(
        { error: data.error?.message || 'Gemini TTS error' },
        { status: res.status }
      );
    }

    const part = data.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) {
      return Response.json({ error: 'No audio returned by Gemini' }, { status: 500 });
    }

    // Gemini returns raw PCM (16-bit, 24 kHz, mono) — wrap it in a WAV header
    const mimeType = part.inlineData.mimeType || 'audio/pcm;rate=24000';
    const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] ?? '24000', 10);
    const pcmBytes = base64ToUint8Array(part.inlineData.data);
    const wavBytes = pcmToWav(pcmBytes, sampleRate);

    return Response.json({ audioContent: uint8ArrayToBase64(wavBytes) });
  } catch (err) {
    return Response.json({ error: `TTS request failed: ${err.message}` }, { status: 500 });
  }
}

// --- helpers ---

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const dataLen = pcm.length;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);

  const write = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };

  write(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                                         // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bitsPerSample / 8, true); // byte rate
  v.setUint16(32, channels * bitsPerSample / 8, true);              // block align
  v.setUint16(34, bitsPerSample, true);
  write(36, 'data');
  v.setUint32(40, dataLen, true);

  new Uint8Array(buf).set(pcm, 44);
  return new Uint8Array(buf);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
