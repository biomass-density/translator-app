import React, { useState } from 'react';
import { UI_STRINGS } from '../constants.js';

export default function DeleteModal({ onConfirm, onCancel }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setError('');
    setDeleting(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error('DeleteModal confirm error:', err);
      setError(err.message || UI_STRINGS.errorDeleting);
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-white/20 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h2 className="text-white text-xl font-bold mb-3">{UI_STRINGS.confirmDelete}</h2>
        <p className="text-white/70 text-sm mb-6">{UI_STRINGS.deleteConfirmMessage}</p>

        {error && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-2 text-red-200 text-sm mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white py-2 rounded-xl transition-colors"
          >
            {UI_STRINGS.cancel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-xl transition-colors font-semibold"
          >
            {deleting ? UI_STRINGS.deleting : UI_STRINGS.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
