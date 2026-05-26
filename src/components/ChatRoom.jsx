import React, { useState, useEffect, useRef } from 'react';
import {
  collection, doc, setDoc, onSnapshot,
  query, orderBy, limit, startAfter, getDocs
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { getT } from '../constants.js';
import MessageList from './MessageList.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';

const PAGE_SIZE = 50;
const SEND_COOLDOWN_MS = 1500;


async function translateText(text, targetLanguages) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Translation request failed');
  return data;
}

const TTS_SPEEDS = [0.75, 1, 1.25, 1.5];
const TTS_SPEED_LABELS = { 0.75: '0.75×', 1: '1×', 1.25: '1.25×', 1.5: '1.5×' };

async function fetchTTSAudio(text, language) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'TTS request failed');
  if (!data.audioContent) throw new Error('No audio returned');
  return data.audioContent; // raw base64 MP3
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

  const t = getT(userLanguage);

  // Online / offline detection
  useEffect(() => {
    const setOn = () => setIsOnline(true);
    const setOff = () => setIsOnline(false);
    window.addEventListener('online', setOn);
    window.addEventListener('offline', setOff);
    return () => { window.removeEventListener('online', setOn); window.removeEventListener('offline', setOff); };
  }, []);

  // Screen wake lock — keeps display on while in a room
  useEffect(() => {
    let wakeLock = null;
    const request = async () => {
      if (!('wakeLock' in navigator)) return;
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLock?.release();
    };
  }, []);

  // Web Audio API — AudioContext created on user gesture stays unlocked permanently on iOS
  const audioCtxRef = useRef(null);
  const currentSourceRef = useRef(null);
  const audioQueueRef = useRef([]);   // queue of { base64, msgId }
  const isPlayingRef = useRef(false);
  const spokenIdsRef = useRef(new Set());

  async function playNext() {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setSpeakingMsgId(null);
      setQueueLength(0);
      return;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) { isPlayingRef.current = false; return; }

    const { base64, msgId } = audioQueueRef.current.shift();
    setQueueLength(audioQueueRef.current.length);
    isPlayingRef.current = true;
    setSpeakingMsgId(msgId);

    try {
      const arrayBuffer = base64ToArrayBuffer(base64);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.playbackRate.value = ttsSpeedRef.current;
      currentSourceRef.current = source;
      source.onended = () => { currentSourceRef.current = null; playNext(); };
      source.start(0);
    } catch (err) {
      setTtsError(`Audio error: ${err.message}`);
      setSpeakingMsgId(null);
      playNext();
    }
  }

  function stopAllAudio() {
    try { currentSourceRef.current?.stop(); } catch (_) {}
    currentSourceRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setSpeakingMsgId(null);
    setQueueLength(0);
  }

  async function fetchAndEnqueue(text, msgId) {
    try {
      const base64 = await fetchTTSAudio(text, userLanguage);
      setTtsError('');
      audioQueueRef.current.push({ base64, msgId });
      setQueueLength(audioQueueRef.current.length + (isPlayingRef.current ? 1 : 0));
      if (!isPlayingRef.current) playNext();
    } catch (err) {
      console.error('TTS error:', err.message);
      setTtsError(err.message);
    }
  }

  function toggleListening() {
    if (!listeningMode) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        ctx.resume();
        audioCtxRef.current = ctx;
      }
      setTtsError('');
      spokenIdsRef.current = new Set(messages.map(m => m.id));
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
      // Apply immediately to the currently playing source
      if (currentSourceRef.current) {
        currentSourceRef.current.playbackRate.value = next;
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

  // Watch messages — speak new ones when listening mode is on
  useEffect(() => {
    if (!listeningMode) return;
    for (const msg of messages) {
      if (spokenIdsRef.current.has(msg.id)) continue;
      if (msg.isSystem || msg.senderId === userId) {
        spokenIdsRef.current.add(msg.id);
        continue;
      }
      const needsTranslation = msg.originalLanguage !== userLanguage;
      const translation = msg.translations?.[userLanguage];
      if (needsTranslation && !translation && !msg.translationFailed) continue;
      const text = needsTranslation && translation ? translation : msg.text;
      spokenIdsRef.current.add(msg.id);
      fetchAndEnqueue(text, msg.id);
    }
  }, [messages, listeningMode]);

  // Session history — retroactively translate messages missing our language
  const translatingIdsRef = useRef(new Set());
  useEffect(() => {
    const missing = messages.filter(msg =>
      !msg.isSystem &&
      msg.senderId !== userId &&
      msg.originalLanguage !== userLanguage &&
      !msg.translations?.[userLanguage] &&
      !msg.translationFailed &&
      !translatingIdsRef.current.has(msg.id)
    );
    if (missing.length === 0) return;

    missing.forEach(msg => translatingIdsRef.current.add(msg.id));

    // Stagger calls 400ms apart to avoid rate limiting.
    // Re-check inside the timeout: the sender's real-time translation may have
    // arrived while we were waiting, in which case we must not overwrite it.
    missing.forEach((msg, i) => {
      setTimeout(async () => {
        const already = latestMessagesRef.current.find(m => m.id === msg.id);
        if (already?.translations?.[userLanguage]) {
          translatingIdsRef.current.delete(msg.id); // real-time translation won, skip
          return;
        }
        try {
          const result = await translateText(msg.text, [userLanguage]);
          const msgRef = doc(db, 'rooms', roomId, 'messages', msg.id);
          await setDoc(msgRef, { translations: result.translations ?? {} }, { merge: true });
        } catch (err) {
          console.error('Retroactive translation error:', err.message);
          translatingIdsRef.current.delete(msg.id); // allow retry
        }
      }, i * 400);
    });
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

  // Real-time messages
  useEffect(() => {
    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(msgsRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null);
      setMessages(fetched);
      if (fetched.length > 0) latestMessagesRef.current = fetched; // preserve across room deletion
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
      setMessages((prev) => [...older, ...prev]);
    } catch (err) {
      console.error('Load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || sendDisabled) return;
    setNewMessage('');
    setSendError('');
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
    }
  };

  async function handleEndSessionClick() {
    showEndModalRef.current = true;
    stopAllAudio();
    await onEndSession(); // marks sessionEnded, kicks participants, clears localStorage session
    setShowEndModal(true);
  }

  function exportTranscript() {
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
        <div className={`flex-shrink-0 px-4 py-3 border-t ${inputBarBg}`}>
          {sendError && <p className="text-red-500 text-xs mb-2">{sendError}</p>}
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder={`${t.typeMessage} (${userLanguage})`}
              className={`flex-1 rounded-full px-5 py-3 text-base focus:outline-none ${inputField}`}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sendDisabled}
              className={`w-11 h-11 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors ${sendBtn}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
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
