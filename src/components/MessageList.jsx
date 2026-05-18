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

  const bg = darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]';
  const ownBubble = darkMode ? 'bg-[#F0F0F0] text-[#0A0A0A]' : 'bg-[#0A0A0A] text-[#FFFFFF]';
  const otherBubble = darkMode ? 'bg-[#272727] text-[#F5F5F5]' : 'bg-[#EFEFEF] text-[#0A0A0A]';
  const senderLabel = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const timestampColor = darkMode ? 'text-[#555555]' : 'text-[#9B9B9B]';
  const dividerColor = darkMode ? 'border-[#333333]' : 'border-[#DDDDDD]';
  const originalLabel = darkMode ? 'text-[#666666]' : 'text-[#9B9B9B]';
  const toggleColor = darkMode ? 'text-[#888888] hover:text-[#F5F5F5]' : 'text-[#666666] hover:text-[#0A0A0A]';
  const systemText = darkMode ? 'text-[#555555]' : 'text-[#AAAAAA]';
  const loadMoreBg = darkMode ? 'bg-[#1A1A1A] text-[#888888] hover:text-[#F5F5F5]' : 'bg-[#EFEFEF] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const ownTranslatingColor = darkMode ? 'text-[#0A0A0A]/50' : 'text-[#FFFFFF]/60';

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

        const prevMsg = messages[i - 1];
        const isGrouped = prevMsg && !prevMsg.isSystem && prevMsg.senderId === msg.senderId;

        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isGrouped ? 'mt-0.5' : 'mt-3'}`}
          >
            {!isOwn && !isGrouped && (
              <span className={`text-xs font-medium mb-1 px-1 ${senderLabel}`}>
                {msg.senderName}
              </span>
            )}

            <div
              className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed
                ${isOwn
                  ? `${ownBubble} rounded-[18px] rounded-br-[4px]`
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
                <p className={`italic text-xs ${isOwn ? ownTranslatingColor : originalLabel}`}>{t.translating}</p>
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
