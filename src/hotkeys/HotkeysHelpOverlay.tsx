import { useEffect, useMemo, useState } from "react";
import hotkeysData from "./hotkeys.json";
import type { HotkeyEntry, HotkeyCommand, HotkeysData } from "./types";

// The standard bindings plus our own additions (keys not in the base table).
// Marked with command "DCHEMINK" so they group separately.
const CUSTOM_ENTRIES: HotkeyEntry[] = [
  {
    key: "=",
    command: "DCHEMINK" as HotkeyCommand,
    value: "Oxidize → C=O",
    description: "Add a double-bonded O to the atom (CH3→CHO, CH2→ketone, S→sulfoxide)",
  },
  {
    key: "Space",
    command: "DCHEMINK" as HotkeyCommand,
    value: "Select last drawn",
    description: "Select the most recently drawn molecule + switch to the move tool",
  },
  {
    key: "?",
    command: "DCHEMINK" as HotkeyCommand,
    value: "This help",
    description: "Open / close this hotkeys overlay",
  },
];

const entries = [
  ...(hotkeysData as HotkeysData).entries,
  ...CUSTOM_ENTRIES,
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Searchable overlay listing all parsed hotkeys, grouped by command. */
export function HotkeysHelpOverlay({ open, onClose }: Props) {
  const [filter, setFilter] = useState("");

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);

  const grouped = useMemo(() => groupByCommand(entries, filter), [filter]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Hotkeys"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="hotkeys-help-overlay"
    >
      <div
        className="bg-white rounded-lg shadow-xl border w-[min(720px,90vw)] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hotkeys</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        <div className="p-4 border-b">
          <input
            type="text"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter (key or description)…"
            data-testid="hotkeys-help-filter"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {grouped.length === 0 && (
            <p className="text-slate-400">No hotkeys match.</p>
          )}
          {grouped.map(({ command, items }) => (
            <section key={command}>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                {command}
              </h3>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 gap-x-4">
                {items.map((e, idx) => (
                  <div
                    // Some commands (e.g. SELECT) have multiple bindings with
                    // the same key+value but different descriptions, so we
                    // include the index for uniqueness.
                    key={`${e.command}-${e.key}-${e.value}-${idx}`}
                    className="contents"
                    data-testid={`hotkey-row-${e.command}-${e.key}`}
                  >
                    <dt className="font-mono text-slate-700">
                      <kbd className="px-1.5 py-0.5 border rounded text-xs">{e.key}</kbd>
                    </dt>
                    <dd className="text-slate-600">
                      <span className="font-medium text-slate-800">{e.value}</span>
                      {e.description && (
                        <span className="text-slate-400"> — {e.description}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="p-3 border-t bg-slate-50 text-xs text-slate-500">
          Press <kbd className="px-1.5 py-0.5 border rounded">Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
}

interface Grouped {
  command: HotkeyCommand;
  items: HotkeyEntry[];
}

function groupByCommand(rows: HotkeyEntry[], filter: string): Grouped[] {
  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? rows.filter(
        (e) =>
          e.key.toLowerCase().includes(needle) ||
          e.value.toLowerCase().includes(needle) ||
          e.description.toLowerCase().includes(needle),
      )
    : rows;
  const byCmd = new Map<HotkeyCommand, HotkeyEntry[]>();
  for (const r of matches) {
    const arr = byCmd.get(r.command) ?? [];
    arr.push(r);
    byCmd.set(r.command, arr);
  }
  return Array.from(byCmd.entries()).map(([command, items]) => ({
    command,
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
  }));
}
