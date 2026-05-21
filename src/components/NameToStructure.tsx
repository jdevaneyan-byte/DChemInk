import { useState, useRef } from "react";
import { resolveNameToSmiles } from "@/chem/nameResolve";
import { appendSmilesToCanvas } from "@/chem/canvas";

/**
 * Sidebar section that resolves a chemical name to a drawn structure.
 * On submit it calls PubChem PUG REST, then feeds the returned SMILES to Ketcher.
 */
export function NameToStructure() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    const name = value.trim();
    setError(null);
    setResolving(true);

    try {
      const result = await resolveNameToSmiles(name);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      try {
        // Add to the canvas (don't wipe existing structures) and caption it
        // with the name — consistent with pasting a name.
        await appendSmilesToCanvas(result.smiles, name);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to draw structure"
        );
      }
    } finally {
      setResolving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSubmit();
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
        Name → structure
      </p>
      <div className="flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={resolving}
          placeholder="aspirin, 2-bromopropane…"
          data-testid="name-input"
          className="flex-1 min-w-0 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={resolving}
          data-testid="name-draw-button"
          className="px-3 py-1 text-sm border rounded hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
        >
          {resolving ? "Resolving…" : "Draw"}
        </button>
      </div>
      {error && (
        <p
          className="text-xs text-red-600"
          data-testid="name-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
