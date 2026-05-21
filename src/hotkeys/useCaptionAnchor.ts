import { useEffect } from "react";
import { runOnChain } from "@/chem/canvas";
import type { KetDoc } from "@/chem/canvas";
import { reanchorCaptionsInKet } from "@/chem/layout";

interface KetcherWithEvents {
  editor?: {
    subscribe?: (event: string, handler: () => void) => unknown;
    unsubscribe?: (event: string, handler: unknown) => void;
  };
  getKet(): Promise<string>;
  setMolecule(structStr: string): Promise<void | undefined>;
}

/**
 * Mount once at the app root. Keeps name captions SOLID and centered just below
 * their molecule after any edit: when the user flips (H/V) or rotates a
 * molecule, Ketcher would otherwise transform the loose caption text with it
 * (a flip mirrors its position so the name jumps above the molecule; a rotate
 * spins it off). After every edit settles we re-anchor each caption back to
 * centered-below its nearest fragment.
 *
 * Mechanics:
 *  - We subscribe to the editor's `change` event (polling until the editor
 *    exists, since it may not at mount).
 *  - We DON'T re-anchor mid-drag (that would fight the user). A capture-phase
 *    pointerdown/up pair tracks whether a pointer is active; we only run once
 *    the pointer is released.
 *  - The actual re-anchor runs on the shared canvas write queue (`runOnChain`)
 *    so it doesn't race other canvas mutations.
 *
 * The loop is bounded by idempotency: our own `setMolecule` fires another
 * `change`, but the next re-anchor finds nothing to move → returns false → no
 * `setMolecule`.
 */
export function useCaptionAnchor(): void {
  useEffect(() => {
    let dirty = false;
    let pointerDown = false;
    let busy = false;
    let disposed = false;
    let subscriber: unknown = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function maybeRun(): void {
      if (!dirty || pointerDown || busy) return;
      dirty = false;
      busy = true;
      runOnChain(async () => {
        try {
          const k = window.ketcher as unknown as KetcherWithEvents | undefined;
          if (!k) return;
          const ket = JSON.parse(await k.getKet()) as KetDoc;
          if (reanchorCaptionsInKet(ket)) {
            await k.setMolecule(JSON.stringify(ket));
          }
        } catch {
          /* never throw into Ketcher's event pipeline */
        }
      }).finally(() => {
        busy = false;
      });
    }

    function onChange(): void {
      try {
        dirty = true;
        maybeRun();
      } catch {
        /* swallow */
      }
    }

    function onPointerDown(): void {
      pointerDown = true;
    }
    function onPointerUp(): void {
      pointerDown = false;
      // Let the edit (flip/rotate/move) settle before re-anchoring.
      setTimeout(() => {
        if (!disposed) maybeRun();
      }, 60);
    }

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("pointerup", onPointerUp, { capture: true });

    function trySubscribe(): boolean {
      const editor = (window.ketcher as unknown as KetcherWithEvents | undefined)
        ?.editor;
      if (!editor?.subscribe) return false;
      try {
        subscriber = editor.subscribe("change", onChange);
      } catch {
        return false;
      }
      return true;
    }

    if (!trySubscribe()) {
      // Editor isn't ready at mount; poll until it appears.
      pollTimer = setInterval(() => {
        if (disposed) return;
        if (trySubscribe() && pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 200);
    }

    return () => {
      disposed = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("pointerup", onPointerUp, { capture: true });
      try {
        const editor = (
          window.ketcher as unknown as KetcherWithEvents | undefined
        )?.editor;
        if (editor?.unsubscribe && subscriber !== null) {
          editor.unsubscribe("change", subscriber);
        }
      } catch {
        /* swallow */
      }
    };
  }, []);
}
