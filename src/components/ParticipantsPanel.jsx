import React, { useState } from 'react';
import { LANGUAGES } from '../constants.js';

const LANG_FLAG = Object.fromEntries(LANGUAGES.map(l => [l.name, l.flag]));

export default function ParticipantsPanel({ participants, isOwner, ownerId, currentUserId, onKick, onClose, t, darkMode }) {
  const [kickingId, setKickingId] = useState(null);
  const [error, setError] = useState('');

  const handleKick = async (userId, userName) => {
    setError('');
    setKickingId(userId);
    try {
      await onKick(userId, userName);
    } catch (err) {
      console.error('Kick error:', err);
      setError(err.message || t.errorKicking);
    } finally {
      setKickingId(null);
    }
  };

  const panelBg = darkMode ? 'bg-[#1A1A1A]' : 'bg-[#FFFFFF]';
  const textPrimary = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';
  const textSecondary = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const divider = darkMode ? 'divide-[#2A2A2A]' : 'divide-[#F0F0F0]';
  const borderTop = darkMode ? 'border-[#2A2A2A]' : 'border-[#F0F0F0]';
  const closeBtn = darkMode ? 'bg-[#272727] text-[#888888] hover:text-[#F5F5F5]' : 'bg-[#F2F2F2] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const avatarBg = darkMode ? 'bg-[#333333] text-[#F5F5F5]' : 'bg-[#0A0A0A] text-[#FFFFFF]';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40 p-4">
      <div className={`${panelBg} rounded-3xl w-full max-w-md shadow-xl overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className={`font-bold text-base ${textPrimary}`}>
            {t.participants} ({participants.length})
          </h2>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none transition-colors ${closeBtn}`}
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mx-6 mb-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-2 text-red-600 text-sm">
            {error}
          </div>
        )}

        <ul className={`max-h-72 overflow-y-auto divide-y ${divider} px-2`}>
          {participants.map(p => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm uppercase ${avatarBg}`}>
                  {p.name.charAt(0)}
                </div>
                <div>
                  <div className={`font-medium text-sm flex items-center gap-1.5 ${textPrimary}`}>
                    {p.name}
                    {p.id === currentUserId && (
                      <span className={`text-[10px] font-normal ${textSecondary}`}>({t.you})</span>
                    )}
                    {p.id === ownerId && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-[#333333] text-[#AAAAAA]' : 'bg-[#F0F0F0] text-[#666666]'}`}>
                        Host
                      </span>
                    )}
                  </div>
                  <div className={`text-xs flex items-center gap-1 ${textSecondary}`}>
                    {LANG_FLAG[p.language] && <span>{LANG_FLAG[p.language]}</span>}
                    {p.language}
                  </div>
                </div>
              </div>
              {isOwner && p.id !== currentUserId && (
                <button
                  onClick={() => handleKick(p.id, p.name)}
                  disabled={kickingId === p.id}
                  className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-50 transition-colors"
                >
                  {kickingId === p.id ? t.kicking : t.kick}
                </button>
              )}
            </li>
          ))}
        </ul>

      </div>
    </div>
  );
}
