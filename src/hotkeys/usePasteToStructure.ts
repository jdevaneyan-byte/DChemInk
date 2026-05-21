import { useEffect, useRef } from "react";
import { initRDKit, parseSmiles } from "@/chem/rdkit";
import { resolveNameToSmiles } from "@/chem/nameResolve";
import { classifyPaste } from "@/chem/pasteRoute";
import { appendSmilesToCanvas } from "@/chem/canvas";

export interface PasteStatus {
  kind: "resolving" | "ok" | "error";
  message: string;
}

export interface UsePasteToStructureOptions {
  onStatus?: (s: PasteStatus | null) => void;
}

/**
 * Returns true when the event target is a real user-facing form field.
 *
 * Ketcher mounts a hidden <textarea> whose class name contains "cliparea" —
 * that element always has focus on the canvas, and it IS our target (we want
 * to intercept paste events coming through it). Real <input>/<textarea>
 * elements that are NOT the cliparea are fields the user is typing into and
 * must be left alone.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Ketcher's cliparea textarea — NOT a typing target
  if (Array.from(target.classList).some((c) => c.includes("cliparea"))) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Installs a document-level capture-phase `paste` listener.
 *
 * - Ignores paste events targeting real form fields (inputs / textareas that
 *   are not Ketcher's cliparea).
 * - Waits until RDKit is ready before intercepting anything; if RDKit is not
 *   ready yet the event falls through to Ketcher unchanged.
 * - Uses `classifyPaste` to decide what was pasted:
 *   - "structure" / "empty" → let Ketcher handle it as usual.
 *   - "name" → prevent the default paste, resolve via PubChem, and ADD the
 *     result as a new fragment on the canvas (preserving existing drawing).
 */
export function usePasteToStructure(opts: UsePasteToStructureOptions = {}): void {
  const { onStatus } = opts;
  const rdkitReady = useRef(false);
  // Serialises paste resolutions. Each pasted name is appended to this promise
  // chain so its resolve+draw fully completes before the next one reads the
  // canvas — without this, two names pasted within the ~0.7s PubChem window
  // both see an empty canvas and the second setMolecule replaces the first.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // Kick off RDKit initialisation in the background; mark ready when done.
    void initRDKit().then(() => {
      rdkitReady.current = true;
    });

    function isValidSmiles(s: string): boolean {
      try {
        const m = parseSmiles(s);
        const ok = !!m;
        m?.delete();
        return ok;
      } catch {
        return false;
      }
    }

    function handlePaste(event: ClipboardEvent): void {
      // Don't hijack paste in real form fields.
      if (isTypingTarget(event.target)) return;

      // If RDKit hasn't loaded yet, let Ketcher handle it (current behaviour).
      if (!rdkitReady.current) return;

      const text = event.clipboardData?.getData("text/plain") ?? "";

      const kind = classifyPaste(text, isValidSmiles);

      // Structures and empty pastes are handled by Ketcher as normal.
      if (kind === "structure" || kind === "empty") return;

      // Chemical name — intercept and resolve.
      event.preventDefault();
      event.stopImmediatePropagation();

      const name = text.trim();
      // Append to the serial queue so concurrent pastes don't race: each name
      // resolves and is drawn before the next one reads the canvas.
      queue.current = queue.current.then(() => resolveAndAdd(name));
    }

    async function resolveAndAdd(name: string): Promise<void> {
      onStatus?.({ kind: "resolving", message: `Resolving "${name}"…` });

      try {
        const result = await resolveNameToSmiles(name);

        if ("error" in result) {
          onStatus?.({ kind: "error", message: result.error });
          return;
        }

        // Add the resolved SMILES as a new fragment (never replace) and
        // caption it with the pasted name.
        await appendSmilesToCanvas(result.smiles, name);
        onStatus?.({ kind: "ok", message: "" });
      } catch {
        onStatus?.({ kind: "error", message: "Could not place pasted structure" });
      }
    }

    // Wrapper to bridge the sync listener signature; handlePaste enqueues work.
    function listener(event: ClipboardEvent): void {
      handlePaste(event);
    }

    document.addEventListener("paste", listener, { capture: true });
    return () => {
      document.removeEventListener("paste", listener, { capture: true });
    };
  }, [onStatus]);
}
