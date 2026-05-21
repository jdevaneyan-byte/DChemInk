import { useEffect } from "react";
import type { MolProperties } from "@/chem/properties";
import { PROPERTY_GLOSSARY } from "@/chem/propertyGlossary";

interface Props {
  /** The property label (glossary key) to explain, or null when closed. */
  term: string | null;
  props: MolProperties | null;
  onClose: () => void;
}

/**
 * Explains a single property: its definition, how it's computed, and a
 * molecule-specific sentence quoting the current value. Closes on Esc, on
 * backdrop click, and via the ✕ button. Mirrors HotkeysHelpOverlay's styling.
 */
export function PropertyInfoModal({ term, props, onClose }: Props) {
  useEffect(() => {
    if (!term) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [term, onClose]);

  if (!term) return null;
  const entry = PROPERTY_GLOSSARY[term];
  if (!entry) return null;

  return (
    <div
      role="dialog"
      aria-label={entry.term}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="property-info-modal"
    >
      <div
        className="bg-white rounded-lg shadow-xl border w-[min(460px,90vw)] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">{entry.term}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <p className="text-slate-700">{entry.definition}</p>
          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              How it's computed
            </h3>
            <p className="text-slate-700">{entry.method}</p>
          </div>
          {props && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                For this molecule
              </h3>
              <p className="text-slate-700">{entry.perMolecule(props)}</p>
            </div>
          )}
        </div>
        <div className="p-3 border-t bg-slate-50 text-xs text-slate-500">
          Press <kbd className="px-1.5 py-0.5 border rounded">Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
}
