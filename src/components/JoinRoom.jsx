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

export default function JoinRoom({ onJoin, onCreateRoom, darkMode, onToggleDarkMode }) {
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState(LANGUAGES[0].name);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const t = getT(language);

  // Theme-aware class shortcuts
  const bg = darkMode ? 'bg-[#1C1C1E]' : 'bg-[#FAFAF7]';
  const cardBg = darkMode ? 'bg-[#2C2C2E]' : 'bg-white';
  const textPrimary = darkMode ? 'text-white' : 'text-[#1C1C1E]';
  const textSecondary = darkMode ? 'text-[#9B9B9B]' : 'text-[#6B6B6B]';
  const inputBg = darkMode ? 'bg-[#1C1C1E] border-[#3A3A3C] text-white placeholder-[#6B6B6B]' : 'bg-[#F2F2F0] border-transparent text-[#1C1C1E] placeholder-[#9B9B9B]';
  const tabActive = darkMode ? 'bg-[#1C1C1E] text-white' : 'bg-[#F2F2F0] text-[#1C1C1E]';
  const tabInactive = darkMode ? 'text-[#9B9B9B] hover:text-white' : 'text-[#9B9B9B] hover:text-[#1C1C1E]';
  const toggleBg = darkMode ? 'bg-[#2C2C2E] text-[#9B9B9B] hover:text-white' : 'bg-white text-[#6B6B6B] hover:text-[#1C1C1E]';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
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

      {/* Dark mode toggle — top right */}
      <button
        onClick={onToggleDarkMode}
        className={`absolute top-4 right-4 p-2 rounded-full ${toggleBg} transition-colors shadow-sm`}
        aria-label="Toggle dark mode"
      >
        {darkMode ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className={`${cardBg} rounded-3xl p-8 w-full max-w-sm shadow-sm`}>

        {/* Logo */}
        <div className="text-center mb-7">
          <div className="text-4xl mb-2">🌐</div>
          <h1 className={`text-2xl font-bold ${textPrimary} tracking-tight`}>{t.appTitle}</h1>
          <p className={`text-sm mt-1 ${textSecondary}`}>{t.appSubtitle}</p>
        </div>

        {/* Join / Create tabs */}
        <div className={`flex rounded-2xl p-1 mb-6 ${darkMode ? 'bg-[#1C1C1E]' : 'bg-[#F2F2F0]'}`}>
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
          {/* Language — first so the rest of the form changes language immediately */}
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.language}</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500 ${inputBg}`}
            >
              {LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.name}>{lang.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.yourName}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t.yourNamePlaceholder}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500 ${inputBg}`}
              required
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${textSecondary}`}>{t.roomId}</label>
            <input
              type="text"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              placeholder={t.roomIdPlaceholder}
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500 ${inputBg}`}
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
              className={`w-full border rounded-2xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500 ${inputBg}`}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-red-600 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 active:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl transition-colors mt-2 text-base"
          >
            {loading
              ? (isCreating ? t.creating : t.joining)
              : (isCreating ? t.createRoom : t.joinRoom)}
          </button>
        </form>
      </div>
    </div>
  );
}
