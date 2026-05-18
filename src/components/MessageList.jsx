import React, { useEffect, useRef } from 'react';
import { UI_STRINGS } from '../constants.js';

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageList({ messages, currentUserId, userLanguage, hasMore, onLoadMore, loadingMore }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    // Auto-scroll to bottom only when new messages arrive (not when loading earlier)
    if (messages.length > prevLengthRef.current) {
      const added = messages.length - prevLengthRef.current;
      // If messages were appended at the end (new messages), scroll to bottom
      if (added <= 5) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-sm text-indigo-300 hover:text-indigo-100 disabled:opacity-50 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full transition-colors"
          >
            {loadingMore ? UI_STRINGS.loading : UI_STRINGS.loadEarlier}
          </button>
        </div>
      )}

      {messages.map((msg) => {
        if (msg.isSystem) {
          return (
            <div key={msg.id} className="flex justify-center">
              <span className="text-white/40 text-xs bg-white/5 px-3 py-1 rounded-full">
                {msg.action === 'join' && UI_STRINGS.joinedRoom(msg.senderName)}
                {msg.action === 'leave' && UI_STRINGS.leftRoom(msg.senderName)}
                {msg.action === 'kick' &&
                  UI_STRINGS.kickedFrom(msg.senderName, msg.kickerName)}
              </span>
            </div>
          );
        }

        const isOwn = msg.senderId === currentUserId;
        const translation = msg.translations?.[userLanguage];
        const showTranslation =
          translation && msg.originalLanguage !== userLanguage;

        return (
          <div
            key={msg.id}
            className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md xl:max-w-lg rounded-2xl px-4 py-3 shadow-md ${
                isOwn
                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-sm'
                  : 'bg-white/15 text-white rounded-bl-sm'
              }`}
            >
              {!isOwn && (
                <div className="text-xs font-semibold text-indigo-200 mb-1">
                  {msg.senderName}
                  <span className="ml-1 text-white/40 font-normal">
                    · {msg.originalLanguage}
                  </span>
                </div>
              )}

              <p className="text-sm leading-relaxed">{msg.text}</p>

              {showTranslation && (
                <div className="mt-2 pt-2 border-t border-white/20">
                  <p className="text-xs text-white/60 mb-0.5">{UI_STRINGS.originalText}</p>
                  <p className="text-sm leading-relaxed text-white/80">{translation}</p>
                </div>
              )}

              <div
                className={`text-xs mt-1 ${
                  isOwn ? 'text-white/50 text-right' : 'text-white/40'
                }`}
              >
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
