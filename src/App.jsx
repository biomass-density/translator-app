import React, { useState, useEffect } from 'react';
import {
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { hashPassword } from './crypto.js';
import { getT } from './constants.js';
import JoinRoom from './components/JoinRoom.jsx';
import ChatRoom from './components/ChatRoom.jsx';

const SESSION_KEY = 'babelchat_session';
const THEME_KEY = 'babelchat_theme';

export default function App() {
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [kicked, setKicked] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem(THEME_KEY) === 'dark'
  );

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      return next;
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        await attemptSessionRestore(user.uid);
        setAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error('Anonymous sign-in failed:', err);
          setAuthReady(true);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  async function attemptSessionRestore(uid) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.roomId || !saved?.userName || !saved?.userLanguage) return;

      const { roomId, userName, userLanguage } = saved;

      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }

      const participantRef = doc(db, 'rooms', roomId, 'participants', uid);
      const participantSnap = await getDoc(participantRef);
      if (!participantSnap.exists()) {
        localStorage.removeItem(SESSION_KEY);
        setKicked(true);
        return;
      }

      const isOwner = roomSnap.data().createdBy === uid;
      setSession({ roomId, userName, userLanguage, isOwner });
    } catch (err) {
      console.error('Session restore error:', err);
      localStorage.removeItem(SESSION_KEY);
    }
  }

  async function handleJoin({ roomId, name, password, language }) {
    const t = getT(language);
    const hash = await hashPassword(password);
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) throw new Error(t.roomNotFound);

    const roomData = roomSnap.data();
    if (roomData.passwordHash !== hash) throw new Error(t.wrongPassword);

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, { name, language, joinedAt: Date.now(), isOnline: true });

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true, action: 'join', senderName: name,
      senderId: userId, timestamp: Date.now(), translations: {},
    });

    const isOwner = roomData.createdBy === userId;
    const newSession = { roomId, userName: name, userLanguage: language, isOwner };
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setKicked(false);
    setSession(newSession);
  }

  async function handleCreateRoom({ roomId, name, password, language }) {
    const t = getT(language);
    const hash = await hashPassword(password);
    const roomRef = doc(db, 'rooms', roomId);
    const existingSnap = await getDoc(roomRef);

    if (existingSnap.exists()) throw new Error(t.errorCreating);

    await setDoc(roomRef, { passwordHash: hash, createdBy: userId, createdAt: Date.now() });

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, { name, language, joinedAt: Date.now(), isOnline: true });

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true, action: 'join', senderName: name,
      senderId: userId, timestamp: Date.now(), translations: {},
    });

    const newSession = { roomId, userName: name, userLanguage: language, isOwner: true };
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setKicked(false);
    setSession(newSession);
  }

  async function handleLeaveRoom() {
    if (!session || !userId) return;
    const { roomId, userName } = session;
    try {
      await deleteDoc(doc(db, 'rooms', roomId, 'participants', userId));
      const msgsRef = collection(db, 'rooms', roomId, 'messages');
      await setDoc(doc(msgsRef), {
        isSystem: true, action: 'leave', senderName: userName,
        senderId: userId, timestamp: Date.now(), translations: {},
      });
    } catch (err) {
      console.error('Error leaving room:', err);
    } finally {
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
    }
  }

  async function handleDeleteRoom() {
    if (!session || !userId) return;
    const { roomId } = session;
    const batch = writeBatch(db);

    const msgsSnap = await getDocs(collection(db, 'rooms', roomId, 'messages'));
    msgsSnap.forEach(d => batch.delete(d.ref));

    const partsSnap = await getDocs(collection(db, 'rooms', roomId, 'participants'));
    partsSnap.forEach(d => batch.delete(d.ref));

    batch.delete(doc(db, 'rooms', roomId));
    await batch.commit();

    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  async function handleKickParticipant(kickedUserId, kickedUserName) {
    if (!session || !userId) return;
    const { roomId, userName: kickerName } = session;
    await deleteDoc(doc(db, 'rooms', roomId, 'participants', kickedUserId));
    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true, action: 'kick', senderName: kickedUserName,
      kickerName, senderId: kickedUserId, timestamp: Date.now(), translations: {},
    });
  }

  const bg = darkMode ? 'bg-[#1C1C1E]' : 'bg-[#FAFAF7]';
  const text = darkMode ? 'text-white' : 'text-[#1C1C1E]';

  if (!authReady) {
    return (
      <div className={`min-h-screen ${bg} ${text} flex items-center justify-center`}>
        <span className="text-lg font-medium opacity-60">{getT('English').loading}</span>
      </div>
    );
  }

  if (session) {
    return (
      <ChatRoom
        roomId={session.roomId}
        userId={userId}
        userName={session.userName}
        userLanguage={session.userLanguage}
        isOwner={session.isOwner}
        darkMode={darkMode}
        onLeave={handleLeaveRoom}
        onDelete={handleDeleteRoom}
        onKick={handleKickParticipant}
      />
    );
  }

  return (
    <>
      {kicked && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-2xl shadow-lg text-sm font-medium">
          {getT('English').youWereKicked}
        </div>
      )}
      <JoinRoom
        onJoin={handleJoin}
        onCreateRoom={handleCreateRoom}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
      />
    </>
  );
}
