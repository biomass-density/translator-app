import React, { useState } from 'react';
import { LANGUAGES, getT } from '../constants.js';

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function JoinRoom({
  onJoin, onCreateRoom, darkMode, onToggleDarkMode,
  myRooms, onDeleteMyRoom, onDeleteAllMyRooms, prefilledRoomId,
}) {
  const [roomId, setRoomId] = useState(prefilledRoomId || '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState(() => {
    // Pre-select based on browser locale (e.g. "de-DE" → German, "uk" → Ukrainian)
    const code = (navigator.language || '').split('-')[0].toLowerCase();
    const match = LANGUAGES.find(l => l.code === code);
    return match ? match.name : LANGUAGES[0].name;
  });
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const t = getT(language);
  const myRoomsList = Object.entries(myRooms || {}).sort((a, b) => b[1].createdAt - a[1].createdAt);

  const bg = darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]';
  const cardBg = darkMode ? 'bg-[#1A1A1A]' : 'bg-[#FFFFFF]';
  const textPrimary = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';
  const textSecondary = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const inputBg = darkMode
    ? 'bg-[#272727] border-[#333333] text-[#F5F5F5] placeholder-[#555555]'
    : 'bg-[#F2F2F2] border-transparent text-[#0A0A0A] placeholder-[#AAAAAA]';
  const tabContainerBg = darkMode ? 'bg-[#0A0A0A]' : 'bg-[#F0F0F0]';
  const tabActive = darkMode ? 'bg-[#272727] text-[#F5F5F5]' : 'bg-[#FFFFFF] text-[#0A0A0A]';
  const tabInactive = darkMode ? 'text-[#666666] hover:text-[#F5F5F5]' : 'text-[#999999] hover:text-[#0A0A0A]';
  const toggleBg = darkMode
    ? 'bg-[#1A1A1A] text-[#888888] hover:text-[#F5F5F5] border-[#2A2A2A]'
    : 'bg-[#FFFFFF] text-[#666666] hover:text-[#0A0A0A] border-[#E5E5E5]';
  const primaryBtn = darkMode
    ? 'bg-[#F5F5F5] hover:bg-[#DDDDDD] active:bg-[#CCCCCC] text-[#0A0A0A]'
    : 'bg-[#0A0A0A] hover:bg-[#333333] active:bg-[#555555] text-[#FFFFFF]';
  const cancelBtn = darkMode
    ? 'bg-[#272727] text-[#888888] hover:text-[#F5F5F5]'
    : 'bg-[#F2F2F2] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const borderColor = darkMode ? 'border-[#2A2A2A]' : 'border-[#E5E5E5]';
  const chevronColor = darkMode ? 'text-[#888888]' : 'text-[#666666]';
  const roomItemBg = darkMode ? 'bg-[#272727]' : 'bg-[#F2F2F2]';
  const rejoinColor = darkMode ? 'text-[#888888] hover:text-[#F5F5F5]' : 'text-[#6B6B6B] hover:text-[#0A0A0A]';

  function handleRejoin(rId) {
    setRoomId(rId);
    setPassword('');
    setIsCreating(false);
  }

  async function handleDeleteAll() {
    await onDeleteAllMyRooms();
    setConfirmDeleteAll(false);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (roomId.trim().length < 3 || roomId.trim().length > 50) {
      setError('Room ID must be 3–50 characters.');
      return;
    }
    if (isCreating && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!roomId.trim() || !name.trim() || !password.trim()) return;
    setLoading(true);
    try {
      if (isCreating) {
        await onCreateRoom({ roomId: roomId.trim(), name: name.trim(), password, language });
      } else {
        await onJoin({ roomId: roomId.trim(), name: name.trim(), password, language });
      }
    } catch (err) {
      console.error('JoinRoom error:', err);
      setError(err.message || (isCreating ? t.errorCreating : t.errorJoining));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${bg} flex items-center justify-center p-4 relative`}>

      <button
        onClick={onToggleDarkMode}
        className={`absolute top-4 right-4 p-2 rounded-full border transition-colors shadow-sm ${toggleBg}`}
        aria-label="Toggle dark mode"
      >
        {darkMode ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className={`${cardBg} rounded-3xl p-8 w-full max-w-sm shadow-sm`}>

        <div className="text-center mb-7">
          <h1 className={`text-2xl font-bold ${textPrimary} tracking-tight`}>{t.appTitle}</h1>
          <p className={`text-sm mt-1 ${textSecondary}`}>{t.appSubtitle}</p>
        </div>

        <div className={`flex rounded-2xl p-1 mb-6 ${tabContainerBg}`}>
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all ${!isCreating ? tabActive + ' shadow-sm' : tabInactive}`}
          >
            {t.joinRoom}
          </button>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all ${isCreating ? tabActive + ' shadow-sm' : tabInactive}`}
          >
            {t.createRoom}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.language}</label>
            <div className="relative">
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none appearance-none ${inputBg}`}
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.name}>{lang.flag} {lang.nativeName}</option>
                ))}
              </select>
              <div className={`pointer-events-none absolute inset-y-0 right-4 flex items-center ${chevronColor}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.yourName}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t.yourNamePlaceholder}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none ${inputBg}`}
              required
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.roomId}</label>
            <input
              type="text"
              value={roomId}
              onChange={e => setRoomId(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
              placeholder={t.roomIdPlaceholder}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none ${inputBg}`}
              required
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.password}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none ${inputBg}`}
              required
            />
          </div>

          {error && (
            <div className={`rounded-2xl px-4 py-3 text-red-500 text-sm border border-red-500/20 ${darkMode ? 'bg-red-500/10' : 'bg-red-50'}`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full disabled:opacity-50 disabled:cursor-not-allowed font-semibold py-3.5 rounded-2xl transition-colors mt-2 text-base ${primaryBtn}`}
          >
            {loading
              ? (isCreating ? t.creating : t.joining)
              : (isCreating ? t.createRoom : t.joinRoom)}
          </button>
        </form>

        {myRoomsList.length > 0 && (
          <div className={`mt-6 pt-6 border-t ${borderColor}`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>Open Rooms</span>
              <button
                type="button"
                onClick={() => setConfirmDeleteAll(true)}
                className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
              >
                {t.deleteAll}
              </button>
            </div>
            <ul className="space-y-2">
              {myRoomsList.map(([rId, rData]) => (
                <li key={rId} className={`flex items-center justify-between px-3 py-2.5 rounded-2xl ${roomItemBg}`}>
                  <span className={`text-sm font-medium ${textPrimary} truncate`}>#{rId}</span>
                  <div className="flex items-center gap-3 ml-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRejoin(rId)}
                      className={`text-xs font-semibold transition-colors ${rejoinColor}`}
                    >
                      {t.rejoin}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteMyRoom(rId)}
                      className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
                    >
                      {t.delete}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {confirmDeleteAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className={`${cardBg} rounded-3xl p-6 w-full max-w-sm shadow-xl`}>
            <p className={`text-sm mb-6 leading-relaxed ${textSecondary}`}>{t.deleteAllConfirm}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteAll(false)}
                className={`flex-1 py-3 rounded-2xl font-semibold text-sm transition-colors ${cancelBtn}`}
              >
                {t.cancel}
              </button>
              <button
                onClick={handleDeleteAll}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                {t.deleteAll}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
