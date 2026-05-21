import type { HotkeyEntry } from "./types";

export interface KeyContext {
  /** The key character (e.g. `"m"`, `"M"`, `"3"`, `"?"`). */
  key: string;
  /** Modifier states (true = held). */
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Find the hotkey entry that matches `ctx`, or `null` if none.
 * Hotkeys with any modifier held never match — we don't want to shadow
 * Ctrl+Z / Cmd+S / etc. that the browser or Ketcher own.
 */
export function resolveHotkey(
  table: readonly HotkeyEntry[],
  ctx: KeyContext,
): HotkeyEntry | null {
  if (ctx.ctrl || ctx.alt || ctx.meta) return null;
  return table.find((e) => e.key === ctx.key) ?? null;
}

/**
 * True for a bare printable key — a single character with no Ctrl/Alt/Meta
 * held (Shift is allowed, e.g. `*` or `A`).
 *
 * We use this to decide whether to *swallow* a keystroke that didn't match one
 * of our hotkeys. Without swallowing, the key falls through to Ketcher's own
 * built-in single-key shortcuts, which silently apply query-atom/bond
 * properties (`*` any-atom, `a` aromatic, `rb` ring-bond-count, …) to the atom
 * under the cursor — surprising junk for a normal drawing session. Multi-key
 * names (Delete, Backspace, ArrowLeft, Escape, Enter, Tab) and any modified
 * combo return false, so Ketcher still gets delete / undo / navigation.
 */
export function isBarePrintableKey(ctx: KeyContext): boolean {
  if (ctx.ctrl || ctx.alt || ctx.meta) return false;
  return ctx.key.length === 1;
}
