import React, { useState } from 'react';
import { UI_STRINGS } from '../constants.js';

export default function ParticipantsPanel({ participants, isOwner, currentUserId, onKick, onClose }) {
  const [kickingId, setKickingId] = useState(null);
  const [error, setError] = useState('');

  const handleKick = async (userId, userName) => {
    setError('');
    setKickingId(userId);
    try {
      await onKick(userId, userName);
    } catch (err) {
      console.error('ParticipantsPanel kick error:', err);
      setError(err.message || UI_STRINGS.errorKicking);
    } finally {
      setKickingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-40 p-4">
      <div className="bg-gray-900 border border-white/20 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-white font-bold text-lg">
            {UI_STRINGS.participants} ({participants.length})
          </h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-2 text-red-200 text-sm">
            {error}
          </div>
        )}

        <ul className="max-h-80 overflow-y-auto divide-y divide-white/10">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-6 py-3">
              <div>
                <span className="text-white font-medium">{p.name}</span>
                {p.id === currentUserId && (
                  <span className="ml-2 text-xs text-indigo-300">(you)</span>
                )}
                <div className="text-white/50 text-xs">{p.language}</div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${p.isOnline ? 'bg-green-400' : 'bg-gray-500'}`}
                />
                {isOwner && p.id !== currentUserId && (
                  <button
                    onClick={() => handleKick(p.id, p.name)}
                    disabled={kickingId === p.id}
                    className="text-xs bg-red-600/80 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2 py-1 rounded-lg transition-colors"
                  >
                    {kickingId === p.id ? UI_STRINGS.kicking : UI_STRINGS.kick}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
