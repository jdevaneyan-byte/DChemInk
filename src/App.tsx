import { useState, useCallback, useEffect, useRef } from "react";
import { KetcherCanvas } from "@/canvas/KetcherCanvas";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { HotkeysHelpOverlay } from "@/hotkeys/HotkeysHelpOverlay";
import { useHotkeys } from "@/hotkeys/useHotkeys";
import { useKetcherHover } from "@/hotkeys/useKetcherHover";
import { useCaptionAnchor } from "@/hotkeys/useCaptionAnchor";
import { usePasteToStructure } from "@/hotkeys/usePasteToStructure";
import type { PasteStatus } from "@/hotkeys/usePasteToStructure";

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<PasteStatus | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onStatus = useCallback((s: PasteStatus | null) => {
    // Cancel any pending auto-clear from the previous status.
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    setPasteStatus(s);

    if (s === null) return;

    if (s.kind === "ok") {
      // Clear the "ok" toast quickly — it carries no message to read.
      clearTimerRef.current = setTimeout(() => setPasteStatus(null), 2000);
    } else if (s.kind === "error") {
      clearTimerRef.current = setTimeout(() => setPasteStatus(null), 4000);
    }
    // "resolving" stays until replaced by "ok" or "error".
  }, []);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    };
  }, []);

  useKetcherHover();
  useCaptionAnchor();
  useHotkeys({ onShowHelp: () => setHelpOpen(true) });
  usePasteToStructure({ onStatus });

  const isError = pasteStatus?.kind === "error";

  return (
    <main className="h-screen w-screen flex">
      <div className="flex-1 relative">
        <KetcherCanvas />
        <div
          className="absolute top-1 left-1 text-[10px] font-mono bg-white/80 px-1.5 py-0.5 rounded border text-slate-500 pointer-events-none"
          data-testid="build-badge"
        >
          v0.3.2-bonded-sprout
        </div>
      </div>
      <PropertiesPanel onShowShortcuts={() => setHelpOpen(true)} />
      <HotkeysHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Paste-resolution status toast */}
      {pasteStatus && pasteStatus.message && (
        <div
          data-testid="paste-toast"
          className={[
            "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
            "px-4 py-2 rounded-lg shadow-lg text-sm font-medium pointer-events-none",
            "transition-opacity duration-200",
            isError
              ? "bg-red-600 text-white"
              : "bg-slate-800 text-slate-100",
          ].join(" ")}
        >
          {pasteStatus.message}
        </div>
      )}
    </main>
  );
}
