import React, { useEffect, useRef, useState } from 'react';

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {
    month: 'long', day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function isSameDay(ts1, ts2) {
  if (!ts1 || !ts2) return false;
  return new Date(ts1).toDateString() === new Date(ts2).toDateString();
}

export default function MessageList({
  messages, currentUserId, userLanguage,
  hasMore, onLoadMore, loadingMore,
  speakingMsgId, onRetryTranslation,
  t, darkMode,
}) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const prevLengthRef = useRef(messages.length);
  const isAtBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [retryingIds, setRetryingIds] = useState(new Set());

  // Track whether the user is near the bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = dist < 80;
      isAtBottomRef.current = atBottom;
      setShowScrollBtn(!atBottom);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll when new messages arrive — only if already at the bottom
  useEffect(() => {
    const newMessages = messages.length > prevLengthRef.current;
    prevLengthRef.current = messages.length;
    if (newMessages && isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Snap to bottom on first load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Optimistically hide button so it doesn't linger while scrolling
    setShowScrollBtn(false);
    isAtBottomRef.current = true;
  };

  const toggleOriginal = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRetry = async (msg) => {
    setRetryingIds(prev => new Set(prev).add(msg.id));
    try {
      await onRetryTranslation(msg);
    } finally {
      setRetryingIds(prev => { const s = new Set(prev); s.delete(msg.id); return s; });
    }
  };

  const bg = darkMode ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]';
  const ownBubble = darkMode ? 'bg-[#F0F0F0] text-[#0A0A0A]' : 'bg-[#0A0A0A] text-[#FFFFFF]';
  const otherBubble = darkMode ? 'bg-[#272727] text-[#F5F5F5]' : 'bg-[#EFEFEF] text-[#0A0A0A]';
  const speakingBubble = darkMode ? 'bg-[#3A3A3A] text-[#F5F5F5] ring-1 ring-[#888888]' : 'bg-[#DEDEDE] text-[#0A0A0A] ring-1 ring-[#888888]';
  const senderLabel = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const timestampColor = darkMode ? 'text-[#555555]' : 'text-[#9B9B9B]';
  const dividerColor = darkMode ? 'border-[#333333]' : 'border-[#DDDDDD]';
  const originalLabel = darkMode ? 'text-[#666666]' : 'text-[#9B9B9B]';
  const toggleColor = darkMode ? 'text-[#888888] hover:text-[#F5F5F5]' : 'text-[#666666] hover:text-[#0A0A0A]';
  const systemText = darkMode ? 'text-[#555555]' : 'text-[#AAAAAA]';
  const loadMoreBg = darkMode ? 'bg-[#1A1A1A] text-[#888888] hover:text-[#F5F5F5]' : 'bg-[#EFEFEF] text-[#6B6B6B] hover:text-[#0A0A0A]';
  const emptyText = darkMode ? 'text-[#444444]' : 'text-[#CCCCCC]';
  const dateLabelColor = darkMode ? 'text-[#555555]' : 'text-[#BBBBBB]';
  const scrollBtnBg = darkMode
    ? 'bg-[#272727] text-[#AAAAAA] hover:text-[#F5F5F5] border border-[#3A3A3A]'
    : 'bg-[#FFFFFF] text-[#6B6B6B] hover:text-[#0A0A0A] border border-[#E5E5E5]';

  const nonSystemMessages = messages.filter(m => !m.isSystem);

  return (
    // Outer wrapper is `relative` so the scroll-to-bottom button is anchored to the
    // *visible* area, not the scrollable content inside.
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className={`h-full overflow-y-auto ${bg} px-4 py-3 space-y-1`}>
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

        {nonSystemMessages.length === 0 && !hasMore && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={emptyText}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className={`text-sm ${emptyText}`}>No messages yet</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const showDateSep = !isSameDay(msg.timestamp, prevMsg?.timestamp);

          if (msg.isSystem) {
            return (
              <React.Fragment key={msg.id}>
                {showDateSep && (
                  <div className="flex items-center gap-3 py-3">
                    <div className={`flex-1 h-px ${darkMode ? 'bg-[#2A2A2A]' : 'bg-[#E5E5E5]'}`} />
                    <span className={`text-[11px] font-medium ${dateLabelColor}`}>{formatDateLabel(msg.timestamp)}</span>
                    <div className={`flex-1 h-px ${darkMode ? 'bg-[#2A2A2A]' : 'bg-[#E5E5E5]'}`} />
                  </div>
                )}
                <div className="flex justify-center py-1">
                  <span className={`text-xs ${systemText}`}>
                    {msg.action === 'join' && t.joinedRoom(msg.senderName)}
                    {msg.action === 'leave' && t.leftRoom(msg.senderName)}
                    {msg.action === 'kick' && t.kickedFrom(msg.senderName, msg.kickerName)}
                  </span>
                </div>
              </React.Fragment>
            );
          }

          const isOwn = msg.senderId === currentUserId;
          const isSpeaking = speakingMsgId === msg.id;
          const translation = msg.translations?.[userLanguage];
          const needsTranslation = !isOwn && msg.originalLanguage !== userLanguage;
          const showTranslation = needsTranslation && translation;
          const isExpanded = expandedIds.has(msg.id);
          const isRetrying = retryingIds.has(msg.id);
          const isGrouped = prevMsg && !prevMsg.isSystem && prevMsg.senderId === msg.senderId && !showDateSep;

          const bubbleClass = isOwn
            ? `${ownBubble} rounded-[18px] rounded-br-[4px]`
            : isSpeaking
              ? `${speakingBubble} rounded-[18px] rounded-bl-[4px]`
              : `${otherBubble} rounded-[18px] rounded-bl-[4px]`;

          return (
            <React.Fragment key={msg.id}>
              {showDateSep && (
                <div className="flex items-center gap-3 py-3">
                  <div className={`flex-1 h-px ${darkMode ? 'bg-[#2A2A2A]' : 'bg-[#E5E5E5]'}`} />
                  <span className={`text-[11px] font-medium ${dateLabelColor}`}>{formatDateLabel(msg.timestamp)}</span>
                  <div className={`flex-1 h-px ${darkMode ? 'bg-[#2A2A2A]' : 'bg-[#E5E5E5]'}`} />
                </div>
              )}
              <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isGrouped ? 'mt-0.5' : 'mt-3'}`}>
                {!isOwn && !isGrouped && (
                  <span className={`text-xs font-medium mb-1 px-1 ${senderLabel}`}>
                    {msg.senderName}
                  </span>
                )}
                <div className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed transition-all ${bubbleClass}`}>
                  {isSpeaking && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="flex gap-0.5 items-end" style={{ height: '12px' }}>
                        <span className="soundbar-bar" style={{ height: '6px', animationDelay: '0ms' }} />
                        <span className="soundbar-bar" style={{ height: '10px', animationDelay: '150ms' }} />
                        <span className="soundbar-bar" style={{ height: '6px', animationDelay: '300ms' }} />
                      </span>
                    </div>
                  )}
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
                    <div>
                      <p className="text-red-400 italic text-xs mb-1">{t.translationUnavailable}</p>
                      <button
                        onClick={() => handleRetry(msg)}
                        disabled={isRetrying}
                        className={`text-[11px] font-medium transition-colors disabled:opacity-50 ${toggleColor}`}
                      >
                        {isRetrying ? '...' : '↻ Retry'}
                      </button>
                    </div>
                  ) : needsTranslation && !translation ? (
                    <p className={`italic ${originalLabel}`}>{msg.text}</p>
                  ) : (
                    <p>{msg.text}</p>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 px-1 ${timestampColor}`}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </React.Fragment>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button — floats over the message list, only visible when scrolled up */}
      <button
        onClick={scrollToBottom}
        aria-label="Scroll to latest message"
        style={{ opacity: showScrollBtn ? 1 : 0, pointerEvents: showScrollBtn ? 'auto' : 'none' }}
        className={`absolute bottom-4 right-4 w-9 h-9 rounded-full shadow-md flex items-center justify-center transition-opacity duration-200 ${scrollBtnBg}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}
