import React, { useState, useEffect, useRef } from 'react';
import {
  collection, doc, setDoc, onSnapshot, writeBatch,
  query, orderBy, limit, startAfter, getDocs
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { getT } from '../constants.js';
import MessageList from './MessageList.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';

const PAGE_SIZE = 50;
// Short enough not to fight a fast typist sending several lines in a row,
// long enough to swallow a double-fire from a held Enter key. The real
// abuse protection is the server-side rate limiter, not this.
const SEND_COOLDOWN_MS = 300;

// Module-level cache so audio survives component re-mounts within the same tab session.
// Keyed by "text|language|speed". Capped at 60 entries (oldest evicted first).
const ttsAudioCache = new Map();

async function translateText(text, targetLanguages, attempt = 0) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguages }),
  });
  const data = await res.json();
  if (!res.ok) {
    // Retry rate limits / server errors — a message left permanently
    // untranslated gets spoken in the wrong language for listeners.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
      return translateText(text, targetLanguages, attempt + 1);
    }
    throw new Error(data.error || 'Translation request failed');
  }
  return data;
}

const TTS_SPEEDS = [0.75, 1, 1.25, 1.5];
const TTS_SPEED_LABELS = { 0.75: '0.75×', 1: '1×', 1.25: '1.25×', 1.5: '1.5×' };

// Returns an ordered array of base64 MP3 segments. Long text is split
// server-side on sentence boundaries, so a single message can come back as
// several segments that must be played back-to-back in order.
async function fetchTTSAudio(text, language, speed = 1, attempt = 0) {
  const key = `${text}|${language}|${speed}`;
  if (ttsAudioCache.has(key)) return ttsAudioCache.get(key);
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, speed }),
  });
  const data = await res.json();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
      return fetchTTSAudio(text, language, speed, attempt + 1);
    }
    throw new Error(data.error || 'TTS request failed');
  }
  const segments = Array.isArray(data.audioSegments) && data.audioSegments.length > 0
    ? data.audioSegments
    : (data.audioContent ? [data.audioContent] : []);
  if (segments.length === 0) throw new Error('No audio returned');
  if (ttsAudioCache.size >= 60) ttsAudioCache.delete(ttsAudioCache.keys().next().value);
  ttsAudioCache.set(key, segments);
  return segments;
}

async function translateBatch(texts, targetLanguages, attempt = 0) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, targetLanguages }),
  });
  const data = await res.json();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
      return translateBatch(texts, targetLanguages, attempt + 1);
    }
    throw new Error(data.error || 'Batch translation request failed');
  }
  return data; // { translationSets: [{ [lang]: "..." }, ...] }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function HeadphonesIcon({ active }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

export default function ChatRoom({ roomId, userId, userName, userLanguage, isOwner, darkMode, onLeave, onEndSession, onKick }) {
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendDisabled, setSendDisabled] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisible, setLastVisible] = useState(null);
  const [listeningMode, setListeningMode] = useState(false);
  const [ttsError, setTtsError] = useState('');
  const [speakingMsgId, setSpeakingMsgId] = useState(null);
  const [queueLength, setQueueLength] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ownerId, setOwnerId] = useState(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const ttsSpeedRef = useRef(1);
  const showEndModalRef = useRef(false);
  const latestMessagesRef = useRef([]);
  const textareaRef = useRef(null);

  const t = getT(userLanguage);

  // Online / offline detection
  useEffect(() => {
    const setOn = () => setIsOnline(true);
    const setOff = () => setIsOnline(false);
    window.addEventListener('online', setOn);
    window.addEventListener('offline', setOff);
    return () => { window.removeEventListener('online', setOn); window.removeEventListener('offline', setOff); };
  }, []);

  // Screen wake lock — keeps display on while in a room.
  // The browser can release the lock at any time (battery saver, tab hidden,
  // system pressure), so re-acquire on release, on tab return, and on any tap.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let wakeLock = null;
    let active = true;
    const request = async () => {
      if (!active || wakeLock || document.visibilityState !== 'visible') return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
          if (active && document.visibilityState === 'visible') request();
        });
      } catch (_) { wakeLock = null; }
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('pointerdown', request);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('pointerdown', request);
      wakeLock?.release().catch(() => {});
      wakeLock = null;
    };
  }, []);

  // Presence — write isOnline + lastSeen every 30 s; mark offline on tab hide / unmount.
  // Skip writes after session ends to avoid recreating a zombie participant doc.
  useEffect(() => {
    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    const writePresence = (online) => {
      if (showEndModalRef.current) return; // session ended — don't touch participant doc
      setDoc(participantRef, { isOnline: online, lastSeen: Date.now() }, { merge: true }).catch(() => {});
    };

    writePresence(true);
    const heartbeat = setInterval(() => writePresence(true), 30000);

    const handleVisibility = () =>
      writePresence(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      writePresence(false);
    };
  }, [roomId, userId]);

  // Web Audio API — AudioContext created on user gesture stays unlocked permanently on iOS
  const audioCtxRef = useRef(null);
  const currentSourceRef = useRef(null);
  // Queue of { status: 'awaiting'|'pending'|'retrying'|'ready'|'failed', ... }.
  // Slots are reserved synchronously when a message arrives so playback order
  // always matches message order, even though fetches finish out of order
  // (a cache hit resolves far sooner than a network round-trip).
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const spokenIdsRef = useRef(new Set());
  const currentItemRef = useRef(null); // currently-playing queue item
  const playGenerationRef = useRef(0); // bumped by stopAllAudio to cancel in-flight chains
  const messagesLoadedRef = useRef(false);        // first message snapshot has arrived
  const pendingListenBaselineRef = useRef(false); // listening began before that snapshot

  async function playNext() {
    const queue = audioQueueRef.current;
    // 'failed' is terminal — only reached after every retry and the
    // original-language fallback have been exhausted, and the listener has
    // been told. Everything else keeps its place in the queue.
    while (queue.length > 0 && queue[0].status === 'failed') queue.shift();

    if (queue.length === 0) {
      isPlayingRef.current = false;
      currentItemRef.current = null;
      setSpeakingMsgId(null);
      setQueueLength(0);
      return;
    }
    // Head of queue is still waiting on a translation, its audio, or a retry —
    // hold the slot rather than skipping ahead, so nothing is spoken out of
    // order or dropped. Playback restarts when the slot resolves.
    if (queue[0].status === 'awaiting' || queue[0].status === 'pending' || queue[0].status === 'retrying') {
      isPlayingRef.current = false;
      currentItemRef.current = null;
      setSpeakingMsgId(null);
      setQueueLength(queue.length);
      return;
    }

    const ctx = audioCtxRef.current;
    if (!ctx) { isPlayingRef.current = false; return; }

    const item = queue.shift();
    currentItemRef.current = item;
    setQueueLength(queue.length);
    isPlayingRef.current = true;
    setSpeakingMsgId(item.msgId);
    playSegment(item, 0, playGenerationRef.current);
  }

  // Plays one message's segments back-to-back. A long message is synthesized
  // as several MP3 chunks; playing only the first is what made long sentences
  // sound like they were missing words.
  async function playSegment(item, index, generation) {
    const ctx = audioCtxRef.current;
    if (!ctx || generation !== playGenerationRef.current) return;

    if (index >= item.segments.length) {
      currentItemRef.current = null;
      playNext();
      return;
    }

    try {
      // Mobile browsers suspend the context when the screen dims; resuming
      // before each segment stops playback from stalling mid-message.
      if (ctx.state === 'suspended') await ctx.resume();
      if (generation !== playGenerationRef.current) return;

      const audioBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(item.segments[index]));
      if (generation !== playGenerationRef.current) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentSourceRef.current = source;
      source.onended = () => {
        if (generation !== playGenerationRef.current) return;
        currentSourceRef.current = null;
        playSegment(item, index + 1, generation);
      };
      source.start(0);
    } catch (err) {
      if (generation !== playGenerationRef.current) return;
      setTtsError(`Audio error: ${err.message}`);
      currentItemRef.current = null;
      setSpeakingMsgId(null);
      playNext();
    }
  }

  function stopAllAudio() {
    playGenerationRef.current += 1; // cancels any in-flight segment chain
    try { currentSourceRef.current?.stop(); } catch (_) {}
    currentSourceRef.current = null;
    currentItemRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setSpeakingMsgId(null);
    setQueueLength(0);
  }

  // Nothing is ever dropped for being slow. A message only stops being retried
  // once it has genuinely exhausted every option, and even then it falls back
  // to audio in the sender's own language rather than going unspoken.
  const TRANSLATION_RETRY_BASE_MS = 2000;  // backoff between translation retries
  const TRANSLATION_FALLBACK_MS = 60000;   // then read the original aloud instead
  const TTS_RETRY_BASE_MS = 1000;          // backoff between audio retries
  const MAX_TTS_ATTEMPTS = 10;             // ~2 min of retrying before fallback

  // Jittered so that every listener in a room does not retry a shared stuck
  // translation in lockstep and stampede the API into rate-limiting itself.
  const backoff = (base, attempt, cap = 20000) =>
    Math.min(base * 2 ** attempt, cap) * (0.75 + Math.random() * 0.5);

  // Drives every unresolved slot forward. Runs on each snapshot and once a
  // second, so slots resolve and retry in place without ever changing position.
  function resolveAwaitingSlots(msgList) {
    const now = Date.now();
    let changed = false;

    for (const item of audioQueueRef.current) {
      // Audio fetch failed earlier — retry it when its backoff expires.
      if (item.status === 'retrying') {
        if (now >= item.nextAttemptAt) startSpeechFetch(item, item.text, item.language);
        continue;
      }
      if (item.status !== 'awaiting') continue;

      // Sender's language matches ours — no translation involved at all.
      // (This is the English-speaker-listening-to-English case.)
      if (item.originalLanguage === userLanguage) {
        startSpeechFetch(item, item.originalText, userLanguage);
        changed = true;
        continue;
      }

      const msg = msgList?.find(m => m.id === item.msgId);
      const translation = msg?.translations?.[userLanguage];
      if (translation) {
        startSpeechFetch(item, translation, userLanguage);
        changed = true;
        continue;
      }

      const waited = now - item.reservedAt;

      // Translation is marked failed — keep retrying it on a backoff rather
      // than accepting the failure. Most failures are transient (rate limit,
      // network blip) and succeed on a later attempt.
      if (msg?.translationFailed && now >= (item.nextTranslationRetryAt ?? 0)) {
        item.translationAttempts = (item.translationAttempts ?? 0) + 1;
        item.nextTranslationRetryAt =
          now + backoff(TRANSLATION_RETRY_BASE_MS, item.translationAttempts);
        retryTranslation(msg).catch(() => {});
      }

      // Last resort, only after a full minute of trying: read the original
      // text in the ORIGINAL language's voice. Degraded but complete — the
      // listener hears the message rather than silently missing it.
      if (waited > TRANSLATION_FALLBACK_MS) {
        item.usedLanguageFallback = true;
        startSpeechFetch(item, item.originalText, item.originalLanguage);
        changed = true;
      }
    }

    if (changed && !isPlayingRef.current) playNext();
  }

  // Fetches a slot's audio and marks it ready. On failure the slot is queued
  // for another attempt instead of being discarded — it keeps its place, so
  // the queue waits for it rather than skipping ahead.
  async function startSpeechFetch(item, text, language) {
    item.status = 'pending';
    item.text = text;
    item.language = language;
    item.ttsAttempts = (item.ttsAttempts ?? 0) + 1;

    try {
      const segments = await fetchTTSAudio(text, language, ttsSpeedRef.current);
      if (!audioQueueRef.current.includes(item)) return; // stopped while fetching
      item.segments = segments;
      item.status = 'ready';
      setTtsError('');
    } catch (err) {
      if (!audioQueueRef.current.includes(item)) return;
      console.error(`TTS error (attempt ${item.ttsAttempts}):`, err.message);

      if (item.ttsAttempts < MAX_TTS_ATTEMPTS) {
        item.status = 'retrying';
        item.nextAttemptAt = Date.now() + backoff(TTS_RETRY_BASE_MS, item.ttsAttempts);
      } else if (!item.usedLanguageFallback && language !== item.originalLanguage) {
        // Audio for the translation is unavailable — try the original text in
        // its own language before giving up on speaking this message at all.
        item.usedLanguageFallback = true;
        item.ttsAttempts = 0;
        item.status = 'retrying';
        item.nextAttemptAt = Date.now();
        item.text = item.originalText;
        item.language = item.originalLanguage;
      } else {
        // Genuinely unrecoverable. Surface it rather than skipping in silence.
        item.status = 'failed';
        setTtsError(t.messageNotReadAloud ?? 'A message could not be read aloud — please read it in the chat.');
      }
    }
    if (!isPlayingRef.current) playNext();
  }

  // Used by the speed toggle to re-speak the current message at a new rate.
  // Goes through startSpeechFetch so it gets the same retry behaviour.
  function fetchAndEnqueue(text, msgId, language = userLanguage) {
    const item = {
      status: 'awaiting', segments: null, msgId, text: null, language: null,
      originalText: text, originalLanguage: language, reservedAt: Date.now(),
      ttsAttempts: 0, nextAttemptAt: 0,
    };
    audioQueueRef.current.push(item);
    setQueueLength(audioQueueRef.current.length);
    startSpeechFetch(item, text, language);
  }

  function toggleListening() {
    if (!listeningMode) {
      // Reuse the existing context. Browsers cap how many AudioContexts a page
      // may hold (Chrome allows ~6), so creating a fresh one on every toggle
      // eventually breaks audio outright. Creating it here still satisfies
      // iOS's requirement that it originate from a user gesture.
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioCtxRef.current = new AudioCtx();
      }
      audioCtxRef.current?.resume().catch(() => {});
      setTtsError('');

      // Establish the "everything before now" baseline so only messages sent
      // AFTER this tap are read aloud. If the first snapshot has not arrived
      // yet the baseline would be empty, and every message that then loaded
      // would be treated as new and read out — a whole page of old audio.
      // In that case defer the baseline to the first snapshot instead.
      if (messagesLoadedRef.current) {
        spokenIdsRef.current = new Set(messages.map(m => m.id));
        pendingListenBaselineRef.current = false;
      } else {
        pendingListenBaselineRef.current = true;
      }
    } else {
      stopAllAudio();
      setTtsError('');
    }
    setListeningMode(prev => !prev);
  }

  function cycleSpeed() {
    setTtsSpeed(prev => {
      const idx = TTS_SPEEDS.indexOf(prev);
      const next = TTS_SPEEDS[(idx + 1) % TTS_SPEEDS.length];
      ttsSpeedRef.current = next;
      // Stop current audio and re-fetch at new speed — avoids chipmunk pitch shift
      if (isPlayingRef.current && currentItemRef.current) {
        const { text, msgId, language } = currentItemRef.current;
        stopAllAudio();
        fetchAndEnqueue(text, msgId, language);
      }
      return next;
    });
  }

  function copyRoomLink() {
    const url = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  // Watch messages — speak new ones when listening mode is on.
  //
  // A slot is reserved for every new message the moment it is seen, BEFORE its
  // translation exists. Waiting for the translation before queueing would let a
  // fast-translating message overtake a slow one and be spoken out of order —
  // which is very easy to hit when several messages are sent in quick
  // succession, or when one translation retries after a transient failure.
  useEffect(() => {
    if (!listeningMode) return;

    // Listening was switched on before the message history had loaded. Adopt
    // the first loaded page as the baseline and speak none of it — the user
    // asked to hear what comes next, not what was already there.
    if (pendingListenBaselineRef.current) {
      if (!messagesLoadedRef.current) return;
      spokenIdsRef.current = new Set(messages.map(m => m.id));
      pendingListenBaselineRef.current = false;
      return;
    }

    for (const msg of messages) {
      if (spokenIdsRef.current.has(msg.id)) continue;
      spokenIdsRef.current.add(msg.id);
      if (msg.isSystem || msg.senderId === userId) continue;

      audioQueueRef.current.push({
        status: 'awaiting',           // waiting for a translation to exist
        msgId: msg.id,
        text: null,
        language: null,
        segments: null,
        originalText: msg.text,
        originalLanguage: msg.originalLanguage,
        reservedAt: Date.now(),
        ttsAttempts: 0,
        nextAttemptAt: 0,
        translationAttempts: 0,
        nextTranslationRetryAt: 0,
        usedLanguageFallback: false,
      });
      setQueueLength(audioQueueRef.current.length);
    }
    resolveAwaitingSlots(messages);
  }, [messages, listeningMode, userLanguage]);

  // Awaiting slots are also re-checked on a timer so the fallback deadline
  // still fires when no new Firestore snapshot arrives to drive it.
  useEffect(() => {
    if (!listeningMode) return;
    const id = setInterval(() => resolveAwaitingSlots(latestMessagesRef.current), 1000);
    return () => clearInterval(id);
  }, [listeningMode, userLanguage]);

  // Session history — retroactively translate messages missing our language.
  // All missing messages go to the translation API in ONE call, then are written
  // to Firestore in batches of 450 (just under the writeBatch 500-op limit).
  const translatingIdsRef = useRef(new Set());
  useEffect(() => {
    // Cap at 30 most-recent to avoid huge requests on rooms with many missed messages
    const missing = messages.filter(msg =>
      !msg.isSystem &&
      msg.senderId !== userId &&
      msg.originalLanguage !== userLanguage &&
      !msg.translations?.[userLanguage] &&
      !msg.translationFailed &&
      !translatingIdsRef.current.has(msg.id)
    ).slice(-30);
    if (missing.length === 0) return;

    missing.forEach(msg => translatingIdsRef.current.add(msg.id));

    (async () => {
      try {
        const texts = missing.map(m => m.text);
        const result = await translateBatch(texts, [userLanguage]);
        const sets = result.translationSets ?? [];

        const BATCH_SIZE = 450;
        let pending = [];
        const written = [];

        const flushBatch = async () => {
          if (pending.length === 0) return;
          const toWrite = pending.splice(0);
          const b = writeBatch(db);
          toWrite.forEach(({ msgId, translations }) =>
            b.set(doc(db, 'rooms', roomId, 'messages', msgId), { translations }, { merge: true })
          );
          await b.commit()
            .then(() => written.push(...toWrite))
            .catch(err => console.error('Batch translation write error:', err.message));
        };

        for (let i = 0; i < missing.length; i++) {
          const msg = missing[i];
          const translations = sets[i] ?? {};

          // Skip if real-time translation arrived while the batch was running
          const already = latestMessagesRef.current.find(m => m.id === msg.id);
          if (already?.translations?.[userLanguage]) {
            translatingIdsRef.current.delete(msg.id);
            continue;
          }

          pending.push({ msgId: msg.id, translations });
          if (pending.length >= BATCH_SIZE) await flushBatch();
        }

        await flushBatch();

        // Show the translations straight away. The live listener only covers
        // the newest PAGE_SIZE messages, so for anything pulled in with
        // "Load earlier" the Firestore write never comes back through a
        // snapshot — without this the reader would keep seeing the original
        // language even though the translation had been stored successfully.
        if (written.length > 0) {
          const byId = new Map(written.map(w => [w.msgId, w.translations]));
          const merge = (m) => byId.has(m.id)
            ? { ...m, translations: { ...(m.translations ?? {}), ...byId.get(m.id) } }
            : m;
          olderMessagesRef.current = olderMessagesRef.current.map(merge);
          setMessages(prev => prev.map(merge));
        }
      } catch (err) {
        console.error('Retroactive translation error:', err.message);
        missing.forEach(m => translatingIdsRef.current.delete(m.id));
      }
    })();
  }, [messages, userLanguage, userId, roomId]);

  // Retry a failed translation manually
  const retryTranslation = async (msg) => {
    const msgRef = doc(db, 'rooms', roomId, 'messages', msg.id);
    translatingIdsRef.current.delete(msg.id);
    await setDoc(msgRef, { translationFailed: false, translations: {} }, { merge: true });
    try {
      const result = await translateText(msg.text, [userLanguage]);
      await setDoc(msgRef, { translations: result.translations ?? {} }, { merge: true });
    } catch (err) {
      await setDoc(msgRef, { translationFailed: true }, { merge: true }).catch(() => {});
    }
  };

  // Clean up audio on unmount
  useEffect(() => () => {
    stopAllAudio();
    audioCtxRef.current?.close();
  }, []);

  // Stale closure fix for participants
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // Watch for room changes and being kicked; also read ownerId
  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    let isInitialSnapshot = true;
    const unsubRoom = onSnapshot(roomRef, (s) => {
      const initial = isInitialSnapshot;
      isInitialSnapshot = false;

      if (!s.exists()) {
        // Room hard-deleted (shouldn't happen in new flow, but handle gracefully)
        if (!showEndModalRef.current) onLeave();
        return;
      }

      const data = s.data();
      setOwnerId(data.createdBy ?? null);

      // Session ended by host — show modal for participants (skip on initial load
      // so joining an already-ended room doesn't immediately trigger the modal)
      if (!initial && data.sessionEnded && !showEndModalRef.current) {
        showEndModalRef.current = true;
        stopAllAudio();
        // Grab the full history right away — our participant doc (and with it
        // read permission) is about to be deleted by the host's kick batch.
        fetchFullHistory();
        setShowEndModal(true);
      }
    }, (err) => console.error('Room watch error:', err));

    const partRef = doc(db, 'rooms', roomId, 'participants', userId);
    const unsubMe = onSnapshot(partRef, (s) => {
      if (!s.exists()) {
        // Delay so the room watcher can fire first if sessionEnded was set.
        // If showEndModalRef is set by then, this is a session-end (not a kick).
        setTimeout(() => {
          if (!showEndModalRef.current) onLeave(); // actually kicked
        }, 500);
      }
    }, (err) => console.error('Participant watch error:', err));

    return () => { unsubRoom(); unsubMe(); };
  }, [roomId, userId, onLeave]);

  // Real-time messages. The live listener only covers the newest PAGE_SIZE
  // messages, so pages the user pulled in with "Load earlier" are kept
  // separately and prepended — otherwise the next snapshot (any new message or
  // translation update) would silently discard everything they just loaded.
  const olderMessagesRef = useRef([]);
  useEffect(() => {
    olderMessagesRef.current = [];
    messagesLoadedRef.current = false;
    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(msgsRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      messagesLoadedRef.current = true; // even an empty room counts as loaded
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null);

      const liveIds = new Set(fetched.map((m) => m.id));
      const older = olderMessagesRef.current.filter((m) => !liveIds.has(m.id));
      const combined = [...older, ...fetched];

      setMessages(combined);
      if (combined.length > 0) latestMessagesRef.current = combined; // preserve across room deletion
    }, (err) => console.error('Messages watch error:', err));
    return unsub;
  }, [roomId]);

  // Real-time participants
  useEffect(() => {
    const partsRef = collection(db, 'rooms', roomId, 'participants');
    const unsub = onSnapshot(partsRef, (snap) => {
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fetched.sort((a, b) => a.joinedAt - b.joinedAt);
      setParticipants(fetched);
    }, (err) => console.error('Participants watch error:', err));
    return unsub;
  }, [roomId]);

  const loadMoreMessages = async () => {
    if (!lastVisible || loadingMore) return;
    setLoadingMore(true);
    try {
      const msgsRef = collection(db, 'rooms', roomId, 'messages');
      const q = query(msgsRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE), startAfter(lastVisible));
      const snap = await getDocs(q);
      const older = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null);
      // These are older than anything already on screen, so they must never be
      // read aloud — without this, tapping "Load earlier" while listening would
      // queue the entire page of history for speech.
      older.forEach((m) => spokenIdsRef.current.add(m.id));
      // Held outside React state so the live listener can re-apply them
      const existing = new Set(olderMessagesRef.current.map((m) => m.id));
      olderMessagesRef.current = [
        ...older.filter((m) => !existing.has(m.id)),
        ...olderMessagesRef.current,
      ];
      setMessages((prev) => [...older.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMessageChange = (e) => {
    setNewMessage(e.target.value);
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (newMessage.trim() && !sendDisabled && newMessage.length <= 500) {
        handleSend(e);
      }
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || sendDisabled || newMessage.length > 500) return;
    setNewMessage('');
    setSendError('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setSendDisabled(true);
    setTimeout(() => setSendDisabled(false), SEND_COOLDOWN_MS);
    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    const newMsgRef = doc(msgsRef);
    try {
      await setDoc(newMsgRef, {
        text, senderId: userId, senderName: userName,
        originalLanguage: userLanguage, timestamp: Date.now(), translations: {},
      });
      const targetLanguages = [...new Set(
        participantsRef.current.map((p) => p.language).filter((lang) => lang !== userLanguage)
      )];
      if (targetLanguages.length > 0) {
        try {
          const result = await translateText(text, targetLanguages);
          await setDoc(newMsgRef, { translations: result.translations ?? {} }, { merge: true });
        } catch (translateErr) {
          console.error('Translation failed —', translateErr.message);
          await setDoc(newMsgRef, { translationFailed: true }, { merge: true }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Send error:', err);
      setSendError(t.errorSending);
      // Put the text back rather than losing it — the input was cleared
      // optimistically before the write was known to have succeeded.
      setNewMessage(prev => (prev ? prev : text));
    }
  };

  // Fetch the ENTIRE message history (not just the paginated view) into
  // latestMessagesRef so the transcript export is complete. Best-effort:
  // after the session ends, participant docs are deleted and Firestore rules
  // deny reads — so this must run while we still have permission, and on
  // failure we keep whatever pages are already loaded.
  async function fetchFullHistory() {
    try {
      const msgsRef = collection(db, 'rooms', roomId, 'messages');
      const snap = await getDocs(query(msgsRef, orderBy('timestamp', 'asc')));
      if (!snap.empty) {
        latestMessagesRef.current = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } catch (_) { /* keep the partial list already in the ref */ }
  }

  async function handleEndSessionClick() {
    showEndModalRef.current = true;
    stopAllAudio();
    await fetchFullHistory(); // grab everything while we still have read access
    await onEndSession(); // marks sessionEnded, kicks participants, clears localStorage session
    setShowEndModal(true);
  }

  async function exportTranscript() {
    await fetchFullHistory(); // no-op fallback if permissions are already gone
    const lines = [];

    for (const msg of latestMessagesRef.current) {
      if (msg.isSystem) continue;
      const translation = msg.translations?.[userLanguage];
      const text = (translation && msg.originalLanguage !== userLanguage) ? translation : msg.text;
      lines.push(text);
    }

    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `babelchat-${roomId}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const headerBg = darkMode ? 'bg-[#0A0A0A] border-[#2A2A2A]' : 'bg-[#FFFFFF] border-[#E5E5E5]';
  const headerText = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';
  const subText = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const iconBtn = darkMode ? 'bg-[#1A1A1A] text-[#888888] hover:text-[#F5F5F5]' : 'bg-[#F2F2F2] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const inputBarBg = darkMode ? 'bg-[#0A0A0A] border-[#2A2A2A]' : 'bg-[#FFFFFF] border-[#E5E5E5]';
  const inputField = darkMode ? 'bg-[#1A1A1A] text-[#F5F5F5] placeholder-[#555555]' : 'bg-[#F2F2F2] text-[#0A0A0A] placeholder-[#AAAAAA]';
  const sendBtn = darkMode ? 'bg-[#F5F5F5] hover:bg-[#DDDDDD] active:bg-[#CCCCCC] text-[#0A0A0A]' : 'bg-[#0A0A0A] hover:bg-[#333333] active:bg-[#555555] text-[#FFFFFF]';
  const listeningBtn = listeningMode
    ? (darkMode ? 'bg-[#F5F5F5] text-[#0A0A0A]' : 'bg-[#0A0A0A] text-[#FFFFFF]')
    : iconBtn;

  return (
    <div className={`h-dvh flex flex-col ${darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b ${headerBg}`}>
        <button onClick={copyRoomLink} className="text-left group" title="Copy room link">
          <h1 className={`font-bold text-base leading-tight ${headerText} group-hover:opacity-70 transition-opacity`}>
            #{roomId}
          </h1>
          <p className={`text-xs ${subText}`}>
            {copied ? '✓ Copied link' : userLanguage}
          </p>
        </button>

        <div className="flex items-center gap-2">
          {/* Listening / TTS button */}
          <button
            onClick={toggleListening}
            className={`relative flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full transition-colors ${ttsError ? 'bg-red-500/10 text-red-500' : listeningBtn}`}
            title={listeningMode ? 'Stop listening' : 'Listen to messages aloud'}
          >
            <HeadphonesIcon active={listeningMode} />
            {listeningMode && !ttsError && <span className="text-xs font-medium">Live</span>}
            {ttsError && <span className="text-xs font-medium">Error</span>}
            {listeningMode && !ttsError && queueLength > 0 && (
              <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${darkMode ? 'bg-[#888888] text-[#0A0A0A]' : 'bg-[#6B6B6B] text-[#FFFFFF]'}`}>
                {queueLength}
              </span>
            )}
          </button>

          {/* TTS speed toggle — only visible when listening */}
          {listeningMode && !ttsError && (
            <button
              onClick={cycleSpeed}
              className={`text-xs font-semibold px-2 py-1.5 rounded-full transition-colors ${iconBtn}`}
              title="Cycle TTS speed"
            >
              {TTS_SPEED_LABELS[ttsSpeed]}
            </button>
          )}

          {/* Participants button */}
          <button
            onClick={() => setShowParticipants(true)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full transition-colors ${iconBtn}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {participants.length}
          </button>

          {isOwner && (
            <button
              onClick={handleEndSessionClick}
              className={`text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${iconBtn}`}
            >
              {t.endSession}
            </button>
          )}

          <button onClick={onLeave} className="text-red-500 hover:text-red-600 text-sm font-medium transition-colors">
            {t.leaveRoom}
          </button>
        </div>
      </div>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-500">
            <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
          </svg>
          <p className="text-xs text-yellow-600 dark:text-yellow-400">No internet connection — messages may not sync</p>
        </div>
      )}

      {/* TTS error banner */}
      {ttsError && (
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-500 flex-1">{ttsError}</p>
          <button onClick={() => setTtsError('')} className="text-red-400 hover:text-red-500 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      <MessageList
        messages={messages}
        currentUserId={userId}
        userLanguage={userLanguage}
        hasMore={hasMore}
        onLoadMore={loadMoreMessages}
        loadingMore={loadingMore}
        speakingMsgId={speakingMsgId}
        onRetryTranslation={retryTranslation}
        t={t}
        darkMode={darkMode}
      />

      {/* Input bar */}
      {isOwner ? (
        <div className={`flex-shrink-0 px-4 pt-3 pb-2 border-t ${inputBarBg}`}>
          {sendError && <p className="text-red-500 text-xs mb-2">{sendError}</p>}
          <form onSubmit={handleSend} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={newMessage}
              onChange={handleMessageChange}
              onKeyDown={handleKeyDown}
              placeholder={`${t.typeMessage} (${userLanguage})`}
              className={`flex-1 rounded-2xl px-4 py-3 text-base focus:outline-none resize-none overflow-hidden leading-relaxed ${inputField}`}
              style={{ maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sendDisabled || newMessage.length > 500}
              className={`w-11 h-11 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors ${sendBtn}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
          <div className="flex justify-end mt-1 pr-1">
            <span className={`text-[11px] font-medium tabular-nums transition-colors
              ${newMessage.length > 500 ? 'text-red-500' : newMessage.length > 400 ? 'text-orange-400' : darkMode ? 'text-[#555555]' : 'text-[#BBBBBB]'}`}>
              {newMessage.length}/500
            </span>
          </div>
        </div>
      ) : (
        <div className={`flex-shrink-0 px-4 py-3 border-t ${inputBarBg}`}>
          <p className={`text-center text-sm ${subText}`}>{t.readOnlyHint}</p>
        </div>
      )}

      {showParticipants && (
        <ParticipantsPanel
          participants={participants}
          isOwner={isOwner}
          ownerId={ownerId}
          currentUserId={userId}
          onKick={onKick}
          onClose={() => setShowParticipants(false)}
          t={t}
          darkMode={darkMode}
        />
      )}

      {showEndModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className={`${darkMode ? 'bg-[#1A1A1A]' : 'bg-[#FFFFFF]'} rounded-3xl p-8 w-full max-w-sm shadow-xl flex flex-col items-center gap-4 text-center`}>
            <span className="text-5xl">🙏</span>
            <div>
              <h2 className={`font-bold text-xl mb-1 ${darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]'}`}>{t.thanksForJoining}</h2>
              <p className={`text-sm ${darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]'}`}>
                {isOwner ? t.sessionEndedHost : t.sessionEndedParticipant}
              </p>
            </div>
            <button
              onClick={exportTranscript}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-colors ${darkMode ? 'bg-[#272727] text-[#F5F5F5] hover:bg-[#333333]' : 'bg-[#F2F2F2] text-[#0A0A0A] hover:bg-[#E5E5E5]'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t.downloadTranscript}
            </button>
            <button
              onClick={onLeave}
              className={`w-full py-3 rounded-2xl text-sm font-semibold transition-colors ${darkMode ? 'bg-[#F5F5F5] text-[#0A0A0A] hover:bg-[#DDDDDD]' : 'bg-[#0A0A0A] text-[#FFFFFF] hover:bg-[#333333]'}`}
            >
              {t.backToHome}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
