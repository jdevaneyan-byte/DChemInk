import { useEffect } from "react";
import hotkeysData from "./hotkeys.json";
import type { HotkeyEntry, HotkeysData } from "./types";
import { resolveHotkey, isBarePrintableKey } from "./dispatch";
import { applyLabel } from "./labelText";
import { applySprout, applyOxidize, applyCharge } from "./sprout";
import { toggleAtomNumbers, selectActiveAtom, selectAllStructure } from "./ketcherBridge";

const entries = (hotkeysData as HotkeysData).entries;

interface UseHotkeysOptions {
  /** Called when `?` (or any binding mapped to help) fires. */
  onShowHelp?: () => void;
}

/**
 * Installs a document-level capture-phase keydown listener that dispatches
 * matching hotkeys to the LABELTEXT / SPROUT handlers.
 *
 * Skipped when the active element is a form field (input / textarea /
 * contenteditable) so we never hijack form typing.
 *
 * Capture phase ensures we see the keydown before Ketcher, but we only
 * `preventDefault` if our table matched — otherwise Ketcher's own keyboard
 * shortcuts (Ctrl-Z, Delete, etc.) are untouched.
 */
export function useHotkeys(options: UseHotkeysOptions = {}): void {
  const { onShowHelp } = options;

  useEffect(() => {
    function handler(event: KeyboardEvent): void {
      // Help overlay shortcut — handle separately because `?` isn't in the
      // hotkey table.
      if (event.key === "?" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        onShowHelp?.();
        return;
      }

      if (isTypingTarget(event.target)) return;

      // '=' — oxidize the hovered/selected atom to C=O (our own addition).
      // Converts CH3→CHO, CH2→ketone, S→S=O.
      if (event.key === "=" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const ketcher = window.ketcher;
        if (ketcher) void applyOxidize(ketcher);
        return;
      }

      // Space — select the entire molecule (every atom + bond). Our own
      // addition; not part of the standard hotkey set.
      if (event.key === " " && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        selectAllStructure(window.ketcher);
        return;
      }

      const ctx = {
        key: event.key,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
      };
      const match = resolveHotkey(entries, ctx);
      if (!match) {
        // Unmatched key: swallow bare printable keys so they can't trigger
        // Ketcher's built-in single-key shortcuts (which apply query-atom/bond
        // properties like `*`, `a`, `rb` to the hovered atom). Delete /
        // Backspace / Arrows / Escape / Enter / Tab and modified combos fall
        // through to Ketcher untouched.
        if (isBarePrintableKey(ctx)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void dispatch(match);
    }

    document.addEventListener("keydown", handler, { capture: true });
    // Lets tests wait for the hook to attach before pressing keys.
    (window as unknown as { __dcheminkHotkeysReady?: boolean }).__dcheminkHotkeysReady = true;
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      (window as unknown as { __dcheminkHotkeysReady?: boolean }).__dcheminkHotkeysReady = false;
    };
  }, [onShowHelp]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Ketcher mounts a hidden <textarea class="cliparea-module_cliparea__*">
  // that always has focus on the canvas — it's only used to capture clipboard
  // events, not for user typing. We DO want hotkeys to fire when it's focused.
  if (Array.from(target.classList).some((c) => c.includes("cliparea"))) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

async function dispatch(entry: HotkeyEntry): Promise<void> {
  const ketcher = window.ketcher;
  if (!ketcher) {
    console.info("[hotkeys] Ketcher not ready");
    return;
  }
  switch (entry.command) {
    case "LABELTEXT":
      await applyLabel(ketcher, entry.value);
      return;
    case "SPROUT":
      await applySprout(ketcher, entry.value);
      return;
    case "CHARGE":
      await applyCharge(ketcher, entry.value === "+" ? 1 : -1);
      return;
    case "ATOMNUMBER":
      toggleAtomNumbers(ketcher);
      return;
    case "SELECT":
      selectActiveAtom(ketcher);
      return;
    default:
      console.info(
        `[hotkeys] command '${entry.command}' not implemented yet (key='${entry.key}')`,
      );
  }
}
