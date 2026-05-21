import { describe, it, expect } from "vitest";
import { resolveHotkey, isBarePrintableKey } from "@/hotkeys/dispatch";
import type { HotkeyEntry } from "@/hotkeys/types";

const TABLE: HotkeyEntry[] = [
  { key: "m", command: "LABELTEXT", value: "Me", description: "" },
  { key: "M", command: "LABELTEXT", value: "MgBr", description: "" },
  { key: "3", command: "SPROUT", value: "3", description: "Adds benzene" },
  { key: "?", command: "LABELTEXT", value: "?", description: "" },
];

describe("resolveHotkey", () => {
  it("matches lowercase keys", () => {
    expect(
      resolveHotkey(TABLE, { key: "m", ctrl: false, alt: false, meta: false })?.value,
    ).toBe("Me");
  });

  it("matches uppercase keys case-sensitively", () => {
    expect(
      resolveHotkey(TABLE, { key: "M", ctrl: false, alt: false, meta: false })?.value,
    ).toBe("MgBr");
  });

  it("returns null when ctrl is held", () => {
    expect(
      resolveHotkey(TABLE, { key: "m", ctrl: true, alt: false, meta: false }),
    ).toBeNull();
  });

  it("returns null when alt is held", () => {
    expect(
      resolveHotkey(TABLE, { key: "m", ctrl: false, alt: true, meta: false }),
    ).toBeNull();
  });

  it("returns null when meta is held", () => {
    expect(
      resolveHotkey(TABLE, { key: "m", ctrl: false, alt: false, meta: true }),
    ).toBeNull();
  });

  it("returns null for unbound keys", () => {
    expect(
      resolveHotkey(TABLE, { key: "q", ctrl: false, alt: false, meta: false }),
    ).toBeNull();
  });

  it("matches the literal '?' key", () => {
    expect(
      resolveHotkey(TABLE, { key: "?", ctrl: false, alt: false, meta: false })?.value,
    ).toBe("?");
  });
});

describe("isBarePrintableKey", () => {
  const ctx = (key: string, mods: Partial<{ ctrl: boolean; alt: boolean; meta: boolean }> = {}) =>
    ({ key, ctrl: false, alt: false, meta: false, ...mods });

  it("is true for bare single-character keys (letters, digits, symbols)", () => {
    expect(isBarePrintableKey(ctx("a"))).toBe(true);
    expect(isBarePrintableKey(ctx("*"))).toBe(true);
    expect(isBarePrintableKey(ctx("4"))).toBe(true);
    expect(isBarePrintableKey(ctx("A"))).toBe(true); // Shift allowed
  });

  it("is false for multi-character (editing/navigation) keys", () => {
    for (const k of ["Delete", "Backspace", "ArrowLeft", "Escape", "Enter", "Tab"]) {
      expect(isBarePrintableKey(ctx(k)), k).toBe(false);
    }
  });

  it("is false when Ctrl/Alt/Meta is held (so Ketcher gets undo/redo etc.)", () => {
    expect(isBarePrintableKey(ctx("a", { ctrl: true }))).toBe(false);
    expect(isBarePrintableKey(ctx("a", { alt: true }))).toBe(false);
    expect(isBarePrintableKey(ctx("a", { meta: true }))).toBe(false);
  });
});
