import React, { useEffect, useRef, useState } from 'react';

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageList({ messages, currentUserId, userLanguage, hasMore, onLoadMore, loadingMore, t, darkMode }) {
  const bottomRef = useRef(null);
  const prevLengthRef = useRef(messages.length);
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => {
    if (messages.length > prevLengthRef.current && messages.length - prevLengthRef.current <= 5) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  const toggleOriginal = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bg = darkMode ? 'bg-[#1C1C1E]' : 'bg-[#FAFAF7]';
  const otherBubble = darkMode ? 'bg-[#2C2C2E] text-white' : 'bg-[#F2F2F0] text-[#1C1C1E]';
  const senderLabel = darkMode ? 'text-[#9B9B9B]' : 'text-[#6B6B6B]';
  const timestampColor = darkMode ? 'text-[#6B6B6B]' : 'text-[#9B9B9B]';
  const dividerColor = darkMode ? 'border-[#3A3A3C]' : 'border-[#E5E5E3]';
  const originalLabel = darkMode ? 'text-[#6B6B6B]' : 'text-[#9B9B9B]';
  const toggleColor = darkMode ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700';
  const systemText = darkMode ? 'text-[#6B6B6B]' : 'text-[#9B9B9B]';
  const loadMoreBg = darkMode ? 'bg-[#2C2C2E] text-[#9B9B9B] hover:text-white' : 'bg-[#F2F2F0] text-[#6B6B6B] hover:text-[#1C1C1E]';

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto ${bg} px-4 py-3 space-y-1`}>
      {hasMore && (
        <div className="flex justify-center py-2 mb-2">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className={`text-xs px-4 py-2 rounded-full transition-colors ${loadMoreBg}`}
          >
            {loadingMore ? t.loading : t.loadEarlier}
          </button>
        </div>
      )}

      {messages.map((msg, i) => {
        if (msg.isSystem) {
          return (
            <div key={msg.id} className="flex justify-center py-2">
              <span className={`text-xs ${systemText}`}>
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
        const isExpanded = expandedIds.has(msg.id);

        // Reduce spacing between consecutive messages from same sender
        const prevMsg = messages[i - 1];
        const isGrouped = prevMsg && !prevMsg.isSystem && prevMsg.senderId === msg.senderId;

        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isGrouped ? 'mt-0.5' : 'mt-3'}`}
          >
            {/* Sender name — show only on first in a group */}
            {!isOwn && !isGrouped && (
              <span className={`text-xs font-medium mb-1 px-1 ${senderLabel}`}>
                {msg.senderName}
              </span>
            )}

            <div
              className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed
                ${isOwn
                  ? 'bg-green-500 text-white rounded-[18px] rounded-br-[4px]'
                  : `${otherBubble} rounded-[18px] rounded-bl-[4px]`
                }`}
            >
              {showTranslation ? (
                <>
                  <p>{translation}</p>
                  <div className={`mt-1.5 pt-1.5 border-t ${dividerColor}`}>
                    <button
                      onClick={() => toggleOriginal(msg.id)}
                      className={`text-[11px] font-medium transition-colors ${toggleColor}`}
                    >
                      {isExpanded ? t.hideOriginal : t.showOriginal}
                    </button>
                    {isExpanded && (
                      <p className={`text-[12px] mt-1 ${originalLabel} italic`}>{msg.text}</p>
                    )}
                  </div>
                </>
              ) : needsTranslation && msg.translationFailed ? (
                <p className="text-red-400 italic text-xs">{t.translationUnavailable}</p>
              ) : needsTranslation && !translation ? (
                <p className={`italic text-xs ${isOwn ? 'text-white/60' : originalLabel}`}>{t.translating}</p>
              ) : (
                <p>{msg.text}</p>
              )}
            </div>

            <span className={`text-[10px] mt-0.5 px-1 ${timestampColor}`}>
              {formatTime(msg.timestamp)}
            </span>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
