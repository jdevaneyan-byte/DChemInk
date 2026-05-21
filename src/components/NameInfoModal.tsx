import { useEffect } from "react";

interface Props {
  /** The full compound name to show, or null when closed. */
  name: string | null;
  onClose: () => void;
}

/**
 * Shows a compound's full name (which is truncated in the sidebar). Closes on
 * Esc, on backdrop click, and via the ✕ button.
 */
export function NameInfoModal({ name, onClose }: Props) {
  useEffect(() => {
    if (!name) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [name, onClose]);

  if (!name) return null;

  return (
    <div
      role="dialog"
      aria-label="Compound name"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="name-info-modal"
    >
      <div
        className="bg-white rounded-lg shadow-xl border w-[min(460px,90vw)] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Name</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm">
          <p className="text-slate-700 break-words" data-testid="name-info-full">
            {name}
          </p>
        </div>
        <div className="p-3 border-t bg-slate-50 text-xs text-slate-500">
          Press <kbd className="px-1.5 py-0.5 border rounded">Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
}
