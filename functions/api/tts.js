// Gemini 2.5 Flash TTS — uses GEMINI_API_KEY, returns audio playable by browsers

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Read aloud in ${language}: ${text}` }] }],
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
      // Return debug info so we can see what actually came back
      return Response.json({
        error: `No audio in response. Structure: ${JSON.stringify(Object.keys(data))}`,
      }, { status: 500 });
    }

    const mimeType = part.inlineData.mimeType || 'audio/pcm;rate=24000';
    const audioData = part.inlineData.data; // base64

    // PCM needs a WAV header to be playable; MP3/OGG/WAV can be returned as-is
    if (mimeType.toLowerCase().includes('pcm') || mimeType.toLowerCase().includes('l16')) {
      const sampleRate = parseInt(mimeType.match(/rate=(\d+)/i)?.[1] ?? '24000', 10);
      const pcmBytes = base64ToUint8Array(audioData);
      const wavBytes = pcmToWav(pcmBytes, sampleRate);
      return Response.json({ audioContent: uint8ArrayToBase64(wavBytes), mimeType: 'audio/wav' });
    }

    // Already a playable format (mp3, ogg, wav, etc.)
    return Response.json({ audioContent: audioData, mimeType });

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
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bitsPerSample / 8, true);
  v.setUint16(32, channels * bitsPerSample / 8, true);
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
