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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Re-anchor only once the editor goes IDLE. Operations like rotate/flip
    // fire `change` continuously; running setMolecule mid-rotation replaces the
    // struct under the active tool and blanks the canvas. A trailing debounce
    // means we never fire until changes stop (rotation released), regardless of
    // how the pointer events are delivered.
    const IDLE_MS = 400;
    function schedule(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!disposed) maybeRun();
      }, IDLE_MS);
    }

    function maybeRun(): void {
      if (!dirty || pointerDown || busy) return;
      // NEVER touch the canvas while Ketcher is actively rotating/moving the
      // selection — calling setMolecule then replaces the struct under the live
      // rotate controller and blanks the canvas. Keep `dirty` and retry later.
      const rc = (window.ketcher as unknown as { editor?: { rotateController?: { isRotating?: boolean; isMovingCenter?: boolean } } } | undefined)?.editor?.rotateController;
      if (rc?.isRotating || rc?.isMovingCenter) {
        schedule();
        return;
      }
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
        schedule(); // debounced — never runs mid-rotation/drag
      } catch {
        /* swallow */
      }
    }

    function onPointerDown(): void {
      pointerDown = true;
    }
    function onPointerUp(): void {
      pointerDown = false;
      schedule(); // re-anchor once things settle
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
      if (debounceTimer !== null) clearTimeout(debounceTimer);
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
