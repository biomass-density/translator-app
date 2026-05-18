import React, { useEffect, useRef } from 'react';

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageList({ messages, currentUserId, userLanguage, hasMore, onLoadMore, loadingMore, t }) {
  const bottomRef = useRef(null);
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    if (messages.length > prevLengthRef.current && messages.length - prevLengthRef.current <= 5) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-sm text-indigo-300 hover:text-indigo-100 disabled:opacity-50 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full transition-colors"
          >
            {loadingMore ? t.loading : t.loadEarlier}
          </button>
        </div>
      )}

      {messages.map((msg) => {
        if (msg.isSystem) {
          return (
            <div key={msg.id} className="flex justify-center">
              <span className="text-white/40 text-xs bg-white/5 px-3 py-1 rounded-full">
                {msg.action === 'join' && t.joinedRoom(msg.senderName)}
                {msg.action === 'leave' && t.leftRoom(msg.senderName)}
                {msg.action === 'kick' && t.kickedFrom(msg.senderName, msg.kickerName)}
              </span>
            </div>
          );
        }

        const isOwn = msg.senderId === currentUserId;
        const translation = msg.translations?.[userLanguage];
        const needsTranslation = !isOwn && msg.originalLanguage !== userLanguage;
        const showTranslation = needsTranslation && translation;

        return (
          <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
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
                  <span className="ml-1 text-white/40 font-normal">· {msg.originalLanguage}</span>
                </div>
              )}

              {showTranslation ? (
                <>
                  <p className="text-sm leading-relaxed">{translation}</p>
                  <div className="mt-2 pt-2 border-t border-white/20">
                    <p className="text-xs text-white/60 mb-0.5">
                      {t.originalText} ({msg.originalLanguage})
                    </p>
                    <p className="text-sm leading-relaxed text-white/80">{msg.text}</p>
                  </div>
                </>
              ) : needsTranslation && msg.translationFailed ? (
                <p className="text-sm leading-relaxed text-red-300/70 italic">
                  {t.translationUnavailable}
                </p>
              ) : needsTranslation && !translation ? (
                <p className="text-sm leading-relaxed text-white/50 italic">
                  {t.translating}
                </p>
              ) : (
                <p className="text-sm leading-relaxed">{msg.text}</p>
              )}

              <div className={`text-xs mt-1 ${isOwn ? 'text-white/50 text-right' : 'text-white/40'}`}>
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
