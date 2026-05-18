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
import { UI_STRINGS } from './constants.js';
import JoinRoom from './components/JoinRoom.jsx';
import ChatRoom from './components/ChatRoom.jsx';

const SESSION_KEY = 'babelchat_session';

export default function App() {
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null); // { roomId, userName, userLanguage, isOwner }
  const [kicked, setKicked] = useState(false);

  // Sign in anonymously once, then attempt session restore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        await attemptSessionRestore(user.uid);
        setAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged will fire again with the new user
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

      // Check room exists
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }

      // Kick-bypass check: if participant doc was deleted, treat as kicked
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
    const hash = await hashPassword(password);
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) {
      throw new Error(UI_STRINGS.roomNotFound);
    }

    const roomData = roomSnap.data();
    if (roomData.passwordHash !== hash) {
      throw new Error(UI_STRINGS.wrongPassword);
    }

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, {
      name,
      language,
      joinedAt: Date.now(),
      isOnline: true,
    });

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true,
      action: 'join',
      senderName: name,
      senderId: userId,
      timestamp: Date.now(),
      translations: {},
    });

    const isOwner = roomData.createdBy === userId;
    const newSession = { roomId, userName: name, userLanguage: language, isOwner };
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setKicked(false);
    setSession(newSession);
  }

  async function handleCreateRoom({ roomId, name, password, language }) {
    const hash = await hashPassword(password);
    const roomRef = doc(db, 'rooms', roomId);
    const existingSnap = await getDoc(roomRef);

    if (existingSnap.exists()) {
      throw new Error('A room with this ID already exists. Please choose a different ID.');
    }

    await setDoc(roomRef, {
      passwordHash: hash,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
    await setDoc(participantRef, {
      name,
      language,
      joinedAt: Date.now(),
      isOnline: true,
    });

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true,
      action: 'join',
      senderName: name,
      senderId: userId,
      timestamp: Date.now(),
      translations: {},
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
      const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
      await deleteDoc(participantRef);

      const msgsRef = collection(db, 'rooms', roomId, 'messages');
      await setDoc(doc(msgsRef), {
        isSystem: true,
        action: 'leave',
        senderName: userName,
        senderId: userId,
        timestamp: Date.now(),
        translations: {},
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

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    const msgsSnap = await getDocs(msgsRef);
    const batch = writeBatch(db);
    msgsSnap.forEach((d) => batch.delete(d.ref));

    const participantsRef = collection(db, 'rooms', roomId, 'participants');
    const participantsSnap = await getDocs(participantsRef);
    participantsSnap.forEach((d) => batch.delete(d.ref));

    const roomRef = doc(db, 'rooms', roomId);
    batch.delete(roomRef);

    await batch.commit();

    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  async function handleKickParticipant(kickedUserId, kickedUserName) {
    if (!session || !userId) return;
    const { roomId, userName: kickerName } = session;

    const participantRef = doc(db, 'rooms', roomId, 'participants', kickedUserId);
    await deleteDoc(participantRef);

    const msgsRef = collection(db, 'rooms', roomId, 'messages');
    await setDoc(doc(msgsRef), {
      isSystem: true,
      action: 'kick',
      senderName: kickedUserName,
      kickerName,
      senderId: kickedUserId,
      timestamp: Date.now(),
      translations: {},
    });
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center">
        <div className="text-white text-xl">{UI_STRINGS.loading}</div>
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
        onLeave={handleLeaveRoom}
        onDelete={handleDeleteRoom}
        onKick={handleKickParticipant}
      />
    );
  }

  return (
    <>
      {kicked && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium">
          {UI_STRINGS.youWereKicked}
        </div>
      )}
      <JoinRoom onJoin={handleJoin} onCreateRoom={handleCreateRoom} />
    </>
  );
}
