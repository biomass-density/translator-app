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
import { hashPassword, generateSalt } from './crypto.js';
import { getT } from './constants.js';
import JoinRoom from './components/JoinRoom.jsx';
import ChatRoom from './components/ChatRoom.jsx';

/** Delete any number of doc refs, chunked into batches of 450. */
async function batchDeleteDocs(db, docRefs) {
  const CHUNK = 450;
  for (let i = 0; i < docRefs.length; i += CHUNK) {
    const b = writeBatch(db);
    docRefs.slice(i, i + CHUNK).forEach(r => b.delete(r));
    await b.commit();
  }
}

const SESSION_KEY = 'babelchat_session';
const THEME_KEY = 'babelchat_theme';
const MY_ROOMS_KEY = 'babelchat_my_rooms';

export default function App() {
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [kicked, setKicked] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem(THEME_KEY) === 'dark'
  );
  const [myRooms, setMyRooms] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(MY_ROOMS_KEY) || '{}');
    } catch {
      return {};
    }
  });
  const [prefilledRoomId] = useState(() => {
    const path = window.location.pathname.slice(1).trim();
    return path || '';
  });

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
      window.history.pushState(null, '', '/' + roomId);
    } catch (err) {
      console.error('Session restore error:', err);
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function saveMyRoom(roomId) {
    setMyRooms(prev => {
      const updated = { ...prev, [roomId]: { createdAt: Date.now() } };
      localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  async function handleJoin({ roomId, name, password, language }) {
    const t = getT(language);
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) throw new Error(t.roomNotFound);

    const roomData = roomSnap.data();
    const salt = roomData.passwordSalt ?? ''; // '' = backward compat with pre-salt rooms
    const hash = await hashPassword(password, salt);
    if (roomData.passwordHash !== hash) throw new Error(t.wrongPassword);

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, { name, language, joinedAt: Date.now(), isOnline: true });

    // Clear any previous sessionEnded flag so watchers don't misfire
    await setDoc(roomRef, { sessionEnded: false }, { merge: true });

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
    window.history.pushState(null, '', '/' + roomId);
  }

  async function handleCreateRoom({ roomId, name, password, language }) {
    const t = getT(language);
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const roomRef = doc(db, 'rooms', roomId);
    const existingSnap = await getDoc(roomRef);

    if (existingSnap.exists()) throw new Error(t.errorCreating);

    await setDoc(roomRef, {
      passwordHash: hash,
      passwordSalt: salt,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, { name, language, joinedAt: Date.now(), isOnline: true });

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true, action: 'join', senderName: name,
      senderId: userId, timestamp: Date.now(), translations: {},
    });

    const newSession = { roomId, userName: name, userLanguage: language, isOwner: true };
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    saveMyRoom(roomId);
    setKicked(false);
    setSession(newSession);
    window.history.pushState(null, '', '/' + roomId);
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
      window.history.pushState(null, '', '/');
    }
  }

  // Ends the session: marks the room as ended and kicks all participants,
  // but does NOT delete messages or the room document.
  // The room remains in My Rooms so the host can delete the data later.
  async function handleEndSession() {
    if (!session || !userId) return;
    const { roomId } = session;

    // Signal to all participant watchers that the session has ended
    await setDoc(doc(db, 'rooms', roomId), { sessionEnded: true }, { merge: true });

    // Kick everyone
    const partsSnap = await getDocs(collection(db, 'rooms', roomId, 'participants'));
    const batch = writeBatch(db);
    partsSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // Clear the active session from localStorage (room stays in myRooms for later deletion)
    localStorage.removeItem(SESSION_KEY);
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

  async function handleDeleteMyRoom(roomId) {
    try {
      const refs = [];
      const msgsSnap = await getDocs(collection(db, 'rooms', roomId, 'messages'));
      msgsSnap.forEach(d => refs.push(d.ref));
      const partsSnap = await getDocs(collection(db, 'rooms', roomId, 'participants'));
      partsSnap.forEach(d => refs.push(d.ref));
      await batchDeleteDocs(db, refs);
      await deleteDoc(doc(db, 'rooms', roomId));
    } catch (err) {
      console.error('Delete my room error:', err);
    }
    setMyRooms(prev => {
      const updated = { ...prev };
      delete updated[roomId];
      localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  async function handleDeleteAllMyRooms() {
    const roomIds = Object.keys(myRooms);
    for (const roomId of roomIds) {
      try {
        const refs = [];
        const msgsSnap = await getDocs(collection(db, 'rooms', roomId, 'messages'));
        msgsSnap.forEach(d => refs.push(d.ref));
        const partsSnap = await getDocs(collection(db, 'rooms', roomId, 'participants'));
        partsSnap.forEach(d => refs.push(d.ref));
        await batchDeleteDocs(db, refs);
        await deleteDoc(doc(db, 'rooms', roomId));
      } catch (err) {
        console.error('Delete room error for', roomId, ':', err);
      }
    }
    localStorage.removeItem(MY_ROOMS_KEY);
    setMyRooms({});
  }

  const bg = darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]';
  const text = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';

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
        onEndSession={handleEndSession}
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
        myRooms={myRooms}
        onDeleteMyRoom={handleDeleteMyRoom}
        onDeleteAllMyRooms={handleDeleteAllMyRooms}
        prefilledRoomId={prefilledRoomId}
      />
    </>
  );
}
