import { useEffect, useState } from "react";
import { initRDKit } from "@/chem/rdkit";
import {
  computeProperties,
  pickFragmentByAtomCount,
  propertiesToTsv,
  propertiesToHtmlTable,
  propertiesToRows,
  type MolProperties,
} from "@/chem/properties";
import { appendPropertyBlock } from "@/chem/canvas";
import { FileImport } from "./FileImport";
import { NameToStructure } from "./NameToStructure";
import { PropertyInfoModal } from "./PropertyInfoModal";
import { NameInfoModal } from "./NameInfoModal";
import { lookupName } from "@/chem/nameRegistry";
import { getHoveredAtomId } from "@/hotkeys/hoverState";
import { copyRich } from "@/lib/clipboard";

const POLL_MS = 500;

interface PropertiesPanelProps {
  /** Opens the hotkeys help overlay (also triggered by the `?` key). */
  onShowShortcuts?: () => void;
}

/** Inline keyboard glyph — we dropped lucide-react, so this is hand-rolled. */
function KeyboardIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M18 14h0M9 14h6" />
    </svg>
  );
}

/** A single property row in the descriptor list. The label is a link-styled
 * button that opens the explanation modal for that term. */
function PropRow({
  label,
  value,
  testId,
  onInfo,
  checked,
  onToggle,
}: {
  label: string;
  value: string;
  testId: string;
  onInfo: (label: string) => void;
  checked: boolean;
  onToggle: (label: string) => void;
}) {
  return (
    <div className="flex justify-between gap-2" data-testid={testId}>
      <dt className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(label)}
          data-testid={`check-${testId}`}
          aria-label={`Select ${label} for paste`}
        />
        <button
          type="button"
          onClick={() => onInfo(label)}
          className="text-left text-slate-500 hover:text-blue-600 hover:underline"
        >
          {label}
        </button>
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

export function PropertiesPanel({ onShowShortcuts }: PropertiesPanelProps = {}) {
  const [props, setProps] = useState<MolProperties | null>(null);
  const [ready, setReady] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [copied, setCopied] = useState<false | "ok" | "fail">(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [infoTerm, setInfoTerm] = useState<string | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState(false);

  function toggleChecked(label: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  useEffect(() => {
    initRDKit().then(() => setReady(true));
  }, []);

  // Light polling of hover state so the indicator updates without coupling
  // PropertiesPanel to React state inside hoverState (which is a singleton).
  useEffect(() => {
    const id = setInterval(() => setHoverId(getHoveredAtomId()), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    async function refresh() {
      const ketcher = window.ketcher;
      if (!ketcher) return;
      let smiles: string;
      try {
        // Ketcher's getSmiles() is async (returns Promise<string>).
        smiles = await ketcher.getSmiles();
      } catch {
        // Ketcher can throw on empty canvas / mid-edit; treat as no structure.
        if (!cancelled) {
          setProps(null);
          setSelectedOnly(false);
          setName(null);
        }
        return;
      }
      if (cancelled) return;
      if (!smiles) {
        setProps(null);
        setSelectedOnly(false);
        setName(null);
        return;
      }

      // If a single molecule is selected, show ITS properties instead of the
      // whole-canvas total. We match the selected fragment by its heavy-atom
      // count (= number of selected atoms) against the canvas's fragments.
      let target = smiles;
      let isSelected = false;
      const selection = (
        ketcher as unknown as {
          editor?: { selection?: () => { atoms?: number[] } | null };
        }
      ).editor?.selection?.();
      const selectedAtomCount = selection?.atoms?.length ?? 0;
      if (selectedAtomCount > 0) {
        const fragment = pickFragmentByAtomCount(smiles, selectedAtomCount);
        if (fragment) {
          target = fragment;
          isSelected = true;
        }
      }

      setProps(computeProperties(target));
      setSelectedOnly(isSelected);
      setName(lookupName(target));
    }

    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready]);

  async function handleCopyCsv() {
    if (!props) return;
    // copyRich works on http (LAN) too, where navigator.clipboard is blocked.
    const ok = await copyRich(propertiesToHtmlTable(props), propertiesToTsv(props));
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied(false), 1800);
  }

  async function handlePasteToCanvas() {
    if (!props || checked.size === 0) return;
    const lines: string[] = [];
    if (name && checked.has("Name")) lines.push(`Name: ${name}`);
    for (const [label, value] of propertiesToRows(props)) {
      if (checked.has(label)) lines.push(`${label}: ${value}`);
    }
    if (lines.length === 0) return;
    await appendPropertyBlock(lines, props.heavyAtoms);
    setPasted(true);
    setTimeout(() => setPasted(false), 1500);
  }

  return (
    <aside className="w-72 border-l p-4 text-sm bg-white space-y-4">
      <FileImport />
      <NameToStructure />
      <button
        type="button"
        onClick={onShowShortcuts}
        data-testid="shortcuts-button"
        title="Show keyboard shortcuts (?)"
        className="w-full px-3 py-1.5 border rounded hover:bg-slate-50 flex items-center justify-between gap-2 text-slate-700"
      >
        <span className="flex items-center gap-2">
          <KeyboardIcon />
          Shortcuts
        </span>
        <kbd className="px-1.5 py-0.5 border rounded text-xs text-slate-500">?</kbd>
      </button>
      <div
        className="text-xs text-slate-500 font-mono"
        data-testid="hover-indicator"
      >
        Hover atom: <span className="text-slate-800">{hoverId ?? "—"}</span>
      </div>
      <div className="space-y-1.5">
        <h2 className="font-semibold">
          Properties
          {selectedOnly && (
            <span
              className="ml-1.5 text-xs font-normal text-emerald-600"
              data-testid="properties-selected-badge"
            >
              (selected)
            </span>
          )}
        </h2>
        {props && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleCopyCsv}
              data-testid="copy-csv-button"
              title="Copy all properties as a table (paste into Excel / Sheets / Word)"
              className="px-1.5 py-0.5 text-[11px] leading-none border rounded hover:bg-slate-50 text-slate-600 whitespace-nowrap"
            >
              {copied === "ok" ? "Copied!" : copied === "fail" ? "Copy failed" : "Copy table"}
            </button>
            <button
              type="button"
              onClick={handlePasteToCanvas}
              disabled={checked.size === 0}
              data-testid="paste-to-canvas-button"
              title="Stamp the checked properties as a text block under the molecule"
              className="px-1.5 py-0.5 text-[11px] leading-none border rounded hover:bg-slate-50 text-slate-600 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pasted ? "Pasted!" : "Paste to canvas"}
            </button>
          </div>
        )}
      </div>
      {props ? (
        <dl className="space-y-1.5">
          {/* Name — always shown at the top; "—" when the structure wasn't
              drawn from a known name (auto-naming a drawn structure needs
              structure→name, not built yet). Only the Name itself is
              checkable/clickable when known. */}
          <div className="flex justify-between gap-2" data-testid="prop-name">
            <dt className="flex items-center gap-1.5 text-slate-500">
              <input
                type="checkbox"
                checked={checked.has("Name")}
                onChange={() => toggleChecked("Name")}
                disabled={!name}
                data-testid="check-prop-name"
                aria-label="Select Name for paste"
              />
              Name
            </dt>
            <dd>
              {name ? (
                <button
                  type="button"
                  onClick={() => setNameOpen(true)}
                  title={name}
                  data-testid="prop-name-value"
                  className="truncate max-w-[10rem] text-left text-slate-800 hover:text-blue-600 hover:underline"
                >
                  {name}
                </button>
              ) : (
                <span data-testid="prop-name-value" className="text-slate-400">
                  —
                </span>
              )}
            </dd>
          </div>

          {/* Identity */}
          <PropRow
            label="Formula"
            value={props.formula}
            testId="prop-formula"
            onInfo={setInfoTerm}
            checked={checked.has("Formula")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Molecular Weight"
            value={props.molWt.toFixed(2)}
            testId="prop-molwt"
            onInfo={setInfoTerm}
            checked={checked.has("Molecular Weight")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Exact Mass"
            value={props.exactMass.toFixed(4)}
            testId="prop-exactmass"
            onInfo={setInfoTerm}
            checked={checked.has("Exact Mass")}
            onToggle={toggleChecked}
          />

          {/* Lipophilicity / ADMET */}
          <PropRow
            label="cLogP"
            value={props.cLogP.toFixed(2)}
            testId="prop-clogp"
            onInfo={setInfoTerm}
            checked={checked.has("cLogP")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Molar Refractivity"
            value={props.molarRefractivity.toFixed(2)}
            testId="prop-molarrefractivity"
            onInfo={setInfoTerm}
            checked={checked.has("Molar Refractivity")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="TPSA"
            value={props.tpsa.toFixed(2)}
            testId="prop-tpsa"
            onInfo={setInfoTerm}
            checked={checked.has("TPSA")}
            onToggle={toggleChecked}
          />

          {/* H-bond / rotatable */}
          <PropRow
            label="HBD"
            value={String(props.hbd)}
            testId="prop-hbd"
            onInfo={setInfoTerm}
            checked={checked.has("HBD")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="HBA"
            value={String(props.hba)}
            testId="prop-hba"
            onInfo={setInfoTerm}
            checked={checked.has("HBA")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Rotatable Bonds"
            value={String(props.rotatableBonds)}
            testId="prop-rotatablebonds"
            onInfo={setInfoTerm}
            checked={checked.has("Rotatable Bonds")}
            onToggle={toggleChecked}
          />

          {/* Atom counts */}
          <PropRow
            label="Heavy Atoms"
            value={String(props.heavyAtoms)}
            testId="prop-heavyatoms"
            onInfo={setInfoTerm}
            checked={checked.has("Heavy Atoms")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Heteroatoms"
            value={String(props.heteroatoms)}
            testId="prop-heteroatoms"
            onInfo={setInfoTerm}
            checked={checked.has("Heteroatoms")}
            onToggle={toggleChecked}
          />

          {/* Ring counts */}
          <PropRow
            label="Rings"
            value={String(props.rings)}
            testId="prop-rings"
            onInfo={setInfoTerm}
            checked={checked.has("Rings")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Aromatic Rings"
            value={String(props.aromaticRings)}
            testId="prop-aromaticrings"
            onInfo={setInfoTerm}
            checked={checked.has("Aromatic Rings")}
            onToggle={toggleChecked}
          />

          {/* Misc */}
          <PropRow
            label="Fraction Csp3"
            value={props.fractionCsp3.toFixed(2)}
            testId="prop-fractioncsp3"
            onInfo={setInfoTerm}
            checked={checked.has("Fraction Csp3")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Stereocenters"
            value={String(props.stereocenters)}
            testId="prop-stereocenters"
            onInfo={setInfoTerm}
            checked={checked.has("Stereocenters")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Amide Bonds"
            value={String(props.amideBonds)}
            testId="prop-amidebonds"
            onInfo={setInfoTerm}
            checked={checked.has("Amide Bonds")}
            onToggle={toggleChecked}
          />

          {/* Lipinski */}
          <PropRow
            label="Lipinski HBA"
            value={String(props.lipinskiHBA)}
            testId="prop-lipinskihba"
            onInfo={setInfoTerm}
            checked={checked.has("Lipinski HBA")}
            onToggle={toggleChecked}
          />
          <PropRow
            label="Lipinski HBD"
            value={String(props.lipinskiHBD)}
            testId="prop-lipinskihbd"
            onInfo={setInfoTerm}
            checked={checked.has("Lipinski HBD")}
            onToggle={toggleChecked}
          />
        </dl>
      ) : (
        <p className="text-slate-400">Draw a structure to see properties.</p>
      )}

      {props && (
        <PropertyInfoModal
          term={infoTerm}
          props={props}
          onClose={() => setInfoTerm(null)}
        />
      )}
      <NameInfoModal
        name={nameOpen ? name : null}
        onClose={() => setNameOpen(false)}
      />
    </aside>
  );
}
