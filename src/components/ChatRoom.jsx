import React, { useState, useEffect, useRef, useCallback } from 'react';
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

async function translateText(text, targetLanguages) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguages }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Translation request failed');
  }
  return data;
}

export default function ChatRoom({ roomId, userId, userName, userLanguage, isOwner, onLeave, onDelete, onKick }) {
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

  const t = getT(userLanguage);

  // Ref keeps target-language list current inside async handleSend without stale closure
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // Watch for room deletion or being kicked (both trigger onLeave(true))
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

  // Real-time messages — latest 50 descending, reversed for display
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

  return (
    <div className="h-dvh bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-sm border-b border-white/10">
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">#{roomId}</h1>
          <p className="text-white/50 text-xs">{userLanguage}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowParticipants(true)}
            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-1.5 rounded-full transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {participants.length}
          </button>
          {isOwner && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="bg-white/10 hover:bg-red-500/30 text-white/70 hover:text-red-300 p-1.5 rounded-full transition-colors"
              title={t.deleteRoom}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
          <button
            onClick={onLeave}
            className="text-red-300 hover:text-red-100 text-sm font-medium hover:underline transition-colors"
          >
            {t.leaveRoom}
          </button>
        </div>
      </div>

      <MessageList
        messages={messages}
        currentUserId={userId}
        userLanguage={userLanguage}
        hasMore={hasMore}
        onLoadMore={loadMoreMessages}
        loadingMore={loadingMore}
        t={t}
      />

      {/* Input — owner only */}
      {isOwner ? (
        <div className="flex-shrink-0 px-4 py-3 bg-black/30 backdrop-blur-sm border-t border-white/10">
          {sendError && <p className="text-red-300 text-xs mb-2">{sendError}</p>}
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`${t.typeMessage} (${userLanguage})`}
              className="flex-1 bg-white/10 border border-white/20 rounded-full px-5 py-3 text-base text-white placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/15"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sendDisabled}
              className="w-11 h-11 flex-shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-all active:scale-95"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      ) : (
        <div className="flex-shrink-0 px-4 py-3 bg-black/30 backdrop-blur-sm border-t border-white/10">
          <p className="text-center text-white/40 text-sm">{t.readOnlyHint}</p>
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
        />
      )}

      {showDeleteModal && (
        <DeleteModal
          onConfirm={onDelete}
          onCancel={() => setShowDeleteModal(false)}
          t={t}
        />
      )}
    </div>
  );
}
