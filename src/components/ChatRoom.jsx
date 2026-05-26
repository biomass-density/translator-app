import React, { useState, useEffect, useRef } from 'react';
import {
  collection, doc, setDoc, onSnapshot,
  query, orderBy, limit, startAfter, getDocs
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { getT } from '../constants.js';
import MessageList from './MessageList.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';
import DeleteModal from './DeleteModal.jsx';

const PAGE_SIZE = 50;
const SEND_COOLDOWN_MS = 1500;

// Minimal silent WAV — no longer needed, removed
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

export default function ChatRoom({ roomId, userId, userName, userLanguage, isOwner, darkMode, onLeave, onDelete, onKick }) {
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendDisabled, setSendDisabled] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisible, setLastVisible] = useState(null);
  const [listeningMode, setListeningMode] = useState(false);
  const [ttsError, setTtsError] = useState('');

  const t = getT(userLanguage);

  // Web Audio API — AudioContext created on user gesture stays unlocked permanently on iOS
  const audioCtxRef = useRef(null);
  const currentSourceRef = useRef(null);
  const audioQueueRef = useRef([]);   // queue of base64 MP3 strings
  const isPlayingRef = useRef(false);
  const spokenIdsRef = useRef(new Set());

  async function playNext() {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) { isPlayingRef.current = false; return; }

    const base64 = audioQueueRef.current.shift();
    isPlayingRef.current = true;

    try {
      const arrayBuffer = base64ToArrayBuffer(base64);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentSourceRef.current = source;
      source.onended = () => { currentSourceRef.current = null; playNext(); };
      source.start(0);
    } catch (err) {
      setTtsError(`Audio error: ${err.message}`);
      playNext();
    }
  }

  function stopAllAudio() {
    try { currentSourceRef.current?.stop(); } catch (_) {}
    currentSourceRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }

  async function fetchAndEnqueue(text) {
    try {
      const base64 = await fetchTTSAudio(text, userLanguage);
      setTtsError('');
      audioQueueRef.current.push(base64);
      if (!isPlayingRef.current) playNext();
    } catch (err) {
      console.error('TTS error:', err.message);
      setTtsError(err.message);
    }
  }

  function toggleListening() {
    if (!listeningMode) {
      // Create AudioContext on user gesture — iOS unlocks it for all future async calls
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

  // Watch messages — speak new ones when listening mode is on
  useEffect(() => {
    if (!listeningMode) return;

    for (const msg of messages) {
      if (spokenIdsRef.current.has(msg.id)) continue;

      // Skip system messages and own messages silently
      if (msg.isSystem || msg.senderId === userId) {
        spokenIdsRef.current.add(msg.id);
        continue;
      }

      const needsTranslation = msg.originalLanguage !== userLanguage;
      const translation = msg.translations?.[userLanguage];

      // Wait until translation is ready (effect re-fires when message doc updates)
      if (needsTranslation && !translation && !msg.translationFailed) continue;

      const text = needsTranslation && translation ? translation : msg.text;
      spokenIdsRef.current.add(msg.id);
      fetchAndEnqueue(text);
    }
  }, [messages, listeningMode]);

  // Clean up audio on unmount
  useEffect(() => () => {
    stopAllAudio();
    audioCtxRef.current?.close();
  }, []);

  // Stale closure fix for participants
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // Watch for room deletion or being kicked
  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    const unsubRoom = onSnapshot(roomRef, (s) => {
      if (!s.exists()) onLeave();
    }, (err) => console.error('Room watch error:', err));

    const partRef = doc(db, 'rooms', roomId, 'participants', userId);
    const unsubMe = onSnapshot(partRef, (s) => {
      if (!s.exists()) onLeave();
    }, (err) => console.error('Participant watch error:', err));

    return () => { unsubRoom(); unsubMe(); };
  }, [roomId, userId, onLeave]);

  // Real-time messages
  useEffect(() => {
    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(msgsRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHasMore(fetched.length === PAGE_SIZE);
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null);
      setMessages(fetched.reverse());
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
        text,
        senderId: userId,
        senderName: userName,
        originalLanguage: userLanguage,
        timestamp: Date.now(),
        translations: {},
      });

      const targetLanguages = [...new Set(
        participantsRef.current
          .map((p) => p.language)
          .filter((lang) => lang !== userLanguage)
      )];

      if (targetLanguages.length > 0) {
        try {
          const result = await translateText(text, targetLanguages);
          const translations = result.translations ?? {};
          await setDoc(newMsgRef, { translations }, { merge: true });
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

  const headerBg = darkMode ? 'bg-[#0A0A0A] border-[#2A2A2A]' : 'bg-[#FFFFFF] border-[#E5E5E5]';
  const headerText = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';
  const subText = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const iconBtn = darkMode ? 'bg-[#1A1A1A] text-[#888888] hover:text-[#F5F5F5]' : 'bg-[#F2F2F2] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const inputBarBg = darkMode ? 'bg-[#0A0A0A] border-[#2A2A2A]' : 'bg-[#FFFFFF] border-[#E5E5E5]';
  const inputField = darkMode
    ? 'bg-[#1A1A1A] text-[#F5F5F5] placeholder-[#555555]'
    : 'bg-[#F2F2F2] text-[#0A0A0A] placeholder-[#AAAAAA]';
  const sendBtn = darkMode
    ? 'bg-[#F5F5F5] hover:bg-[#DDDDDD] active:bg-[#CCCCCC] text-[#0A0A0A]'
    : 'bg-[#0A0A0A] hover:bg-[#333333] active:bg-[#555555] text-[#FFFFFF]';
  const listeningBtn = listeningMode
    ? (darkMode ? 'bg-[#F5F5F5] text-[#0A0A0A]' : 'bg-[#0A0A0A] text-[#FFFFFF]')
    : iconBtn;

  return (
    <div className={`h-dvh flex flex-col ${darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]'}`}>
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b ${headerBg}`}>
        <div>
          <h1 className={`font-bold text-base leading-tight ${headerText}`}>#{roomId}</h1>
          <p className={`text-xs ${subText}`}>{userLanguage}</p>
        </div>
        <div className="flex items-center gap-2">

          {/* Listening mode toggle */}
          <button
            onClick={toggleListening}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full transition-colors ${ttsError ? 'bg-red-500/10 text-red-500' : listeningBtn}`}
            title={listeningMode ? 'Stop listening' : 'Listen to messages aloud'}
          >
            <HeadphonesIcon active={listeningMode} />
            {listeningMode && !ttsError && <span className="text-xs font-medium">Live</span>}
            {ttsError && <span className="text-xs font-medium">Error</span>}
          </button>

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
              onClick={() => setShowDeleteModal(true)}
              className={`p-1.5 rounded-full transition-colors hover:text-red-500 ${iconBtn}`}
              title={t.deleteRoom}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}

          <button onClick={onLeave} className="text-red-500 hover:text-red-600 text-sm font-medium transition-colors">
            {t.leaveRoom}
          </button>
        </div>
      </div>

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
          currentUserId={userId}
          onKick={onKick}
          onClose={() => setShowParticipants(false)}
          t={t}
          darkMode={darkMode}
        />
      )}

      {showDeleteModal && (
        <DeleteModal
          onConfirm={onDelete}
          onCancel={() => setShowDeleteModal(false)}
          t={t}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}
