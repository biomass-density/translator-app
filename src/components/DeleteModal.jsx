import React, { useState } from 'react';

export default function DeleteModal({ onConfirm, onCancel, t, darkMode }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setError('');
    setDeleting(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error('Delete room error:', err);
      setError(err.message || t.errorDeleting);
      setDeleting(false);
    }
  };

  const cardBg = darkMode ? 'bg-[#1A1A1A]' : 'bg-[#FFFFFF]';
  const textPrimary = darkMode ? 'text-[#F5F5F5]' : 'text-[#0A0A0A]';
  const textSecondary = darkMode ? 'text-[#888888]' : 'text-[#6B6B6B]';
  const cancelBtn = darkMode
    ? 'bg-[#272727] text-[#888888] hover:text-[#F5F5F5]'
    : 'bg-[#F2F2F2] text-[#6B6B6B] hover:text-[#0A0A0A]';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`${cardBg} rounded-3xl p-6 w-full max-w-sm shadow-xl`}>
        <h2 className={`font-bold text-lg mb-2 ${textPrimary}`}>{t.confirmDelete}</h2>
        <p className={`text-sm mb-6 leading-relaxed ${textSecondary}`}>{t.deleteConfirmMessage}</p>

        {error && (
          <div className={`rounded-2xl px-4 py-2 text-red-500 text-sm border border-red-500/20 mb-4 ${darkMode ? 'bg-red-500/10' : 'bg-red-50'}`}>
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className={`flex-1 py-3 rounded-2xl font-semibold text-sm transition-colors disabled:opacity-50 ${cancelBtn}`}
          >
            {t.cancel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="flex-1 py-3 rounded-2xl font-semibold text-sm bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? t.deleting : t.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
