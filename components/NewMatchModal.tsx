"use client";

import { useState } from "react";

export default function NewMatchModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, bio: string) => void;
}) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), bio.trim());
    setName("");
    setBio("");
  }

  function handleClose() {
    setName("");
    setBio("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">New match</h3>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Their profile bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Paste their bio, prompts/answers, or describe their photos"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-400">
            We'll generate opening lines right away — including a pun on their name if a natural
            one exists.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Create & generate
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
