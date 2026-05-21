import { useRef, useState } from "react";

const ACCEPTED = [
  ".cdxml",
  ".mol",
  ".sdf",
  ".smi",
  ".smiles",
  ".inchi",
  ".ket",
  ".txt",
].join(",");

/**
 * "Open file" button — reads a chemistry file (CDXML, MOL, SDF, SMILES,
 * InChI, KET) as text and feeds it to Ketcher via `setMolecule`. Ketcher
 * sniffs the format from the content.
 */
export function FileImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const ketcher = window.ketcher;
      if (!ketcher) {
        setError("Editor not ready");
        return;
      }
      await ketcher.setMolecule(text);
    } catch (err) {
      console.error("[FileImport] failed to load", err);
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      // Reset the input so picking the same file twice fires onChange again
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        data-testid="file-import-button"
        className="w-full px-3 py-1.5 text-sm border rounded hover:bg-slate-50 text-left"
      >
        Open file…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handlePick}
        className="hidden"
        data-testid="file-import-input"
      />
      {error && (
        <p className="text-xs text-red-600" data-testid="file-import-error">
          {error}
        </p>
      )}
    </div>
  );
}
