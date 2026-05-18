import React, { useState } from 'react';
import { LANGUAGES, UI_STRINGS } from '../constants.js';

export default function JoinRoom({ onJoin, onCreateRoom }) {
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState(LANGUAGES[0].name);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      setError(err.message || (isCreating ? UI_STRINGS.errorCreating : UI_STRINGS.errorJoining));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 w-full max-w-md shadow-2xl border border-white/20">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">🌐 {UI_STRINGS.appTitle}</h1>
          <p className="text-white/70">{UI_STRINGS.appSubtitle}</p>
        </div>

        <div className="flex rounded-xl overflow-hidden mb-6 border border-white/20">
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              !isCreating
                ? 'bg-white/20 text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {UI_STRINGS.joinRoom}
          </button>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              isCreating
                ? 'bg-white/20 text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {UI_STRINGS.createRoom}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm mb-1">{UI_STRINGS.roomId}</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder={UI_STRINGS.roomIdPlaceholder}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20"
              required
            />
          </div>

          <div>
            <label className="block text-white/80 text-sm mb-1">{UI_STRINGS.yourName}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={UI_STRINGS.yourNamePlaceholder}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20"
              required
            />
          </div>

          <div>
            <label className="block text-white/80 text-sm mb-1">{UI_STRINGS.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={UI_STRINGS.passwordPlaceholder}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20"
              required
            />
          </div>

          <div>
            <label className="block text-white/80 text-sm mb-1">{UI_STRINGS.language}</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/50 focus:bg-white/20"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.name} className="bg-indigo-900 text-white">
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-3 text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-lg"
          >
            {loading
              ? isCreating
                ? UI_STRINGS.creating
                : UI_STRINGS.joining
              : isCreating
              ? UI_STRINGS.createRoom
              : UI_STRINGS.joinRoom}
          </button>
        </form>
      </div>
    </div>
  );
}
