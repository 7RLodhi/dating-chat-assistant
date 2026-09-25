"use client";

export type SideMenuItem = "doubleMeaning" | "darkFantasy";

export default function SideMenu({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: SideMenuItem) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <nav
        className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Side menu"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Chat Assist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect("doubleMeaning")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <span className="text-lg">😜</span>
              Double Meaning Questions
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => onSelect("darkFantasy")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <span className="text-lg">🔥</span>
              Dark Fantasy
              <span className="ml-auto rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                18+
              </span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
