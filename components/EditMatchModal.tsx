"use client";

import { useEffect, useState } from "react";

export default function EditMatchModal({
  open,
  initialName,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset each time it opens (it may be a different match than last time).
  useEffect(() => {
    if (open) {
      setName(initialName);
      setConfirmingDelete(false);
    }
  }, [open, initialName]);

  if (!open) return null;

  const trimmed = name.trim();
  const unchanged = trimmed === initialName.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    onSave(trimmed);
  }

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="text-lg font-semibold text-gray-900">Edit match</h3>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!trimmed || unchanged}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Save name
          </button>
        </form>
        <div className="mt-4 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={handleDeleteClick}
            className={`w-full rounded-md px-4 py-2 text-sm font-medium transition ${
              confirmingDelete
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border border-red-300 text-red-600 hover:bg-red-50"
            }`}
          >
            {confirmingDelete ? "Tap again to confirm delete" : "Delete match"}
          </button>
          {confirmingDelete && (
            <p className="mt-1 text-center text-xs text-gray-400">
              This removes their bio, conversation, and summary from this device.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
