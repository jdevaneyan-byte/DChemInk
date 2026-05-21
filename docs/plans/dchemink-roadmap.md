# DChemInk — Roadmap & Status (where is what)

This is the single source of truth for what's built, what's being built, and
what's deferred. It supersedes the older week-by-week breakdown.

## Ground rules (locked)

- **Browser-only (Tier 0).** No backend, no paid APIs, no heavy downloads on
  the dev PC. Optional ML (Tier 1) is integrated as graceful-degrade + mock +
  docker docs only — never run here.
- **Original work only.** We do NOT copy or derive from any proprietary
  editor's data files (nicknames, style sheets, sample documents, templates).
  We re-author
  every such asset ourselves. Universal chemistry (RDKit descriptors, IUPAC
  via OPSIN) and open file *formats* (MOL/SMILES/CDXML) are fine.
- No 3D, no clipart. Both name→structure and structure→name required.

## Legend
✅ done · 🟡 partial · ⬜ not started · ⏸ deferred (needs infra/decision)

## Status

### Foundation (v0.1–v0.3) ✅
- Vite + React 19 + TS + Ketcher canvas + RDKit-JS + Vitest/Playwright
- File import (CDXML/MOL/SDF/SMILES/InChI/KET via Ketcher)
- Hotkeys: LABELTEXT, SPROUT (15 fragments), CHARGE, ATOMNUMBER, SELECT,
  oxidize `=`, help overlay, hover-as-active-atom
- Space = select last-drawn fragment + switch to move tool
- Live properties: formula, MW, exact mass (3 captions)

### Phase 1 — Chemistry depth (browser-only, all original)
- ✅ **P1.1 Full property panel** — ~18 RDKit descriptors, per-term glossary
  modal, compound-name row, copy-as-table (HTML/TSV), and checkbox →
  paste-selected-properties onto canvas.
- ✅ **P1.2 Name → structure** — sidebar box + paste-name routing. Uses
  PubChem (online). ⚠️ **Offline/.exe builds need a preloaded local resolver
  (OPSIN + curated trivial-name table) — see `../OFFLINE-PACKAGING.md`.**
- ⏸ **P1.3 Structure → name** — ON HOLD (user decision pending). ChemDraw uses
  a bundled *algorithmic* IUPAC name generator (offline, no DB). No mature
  open-source JS equivalent. Options: (a) curated InChIKey→name map + PubChem
  `Title` lookup (online), (b) curated-only (offline, limited), (c) our own
  rule-based IUPAC engine from the public IUPAC Blue Book on top of RDKit
  perception (big, multi-week), (d) STOUT model (Tier-1, self-hosted).
- ✅ **P1.4 Clean-up / auto-layout** — sidebar "Clean up" (Ketcher/Indigo
  layout) + "Clean up · grid" (arranges disconnected fragments into a grid).
  Captions/property-blocks re-anchor to their molecule after layout.
  *TODO later:* "Straighten" (fix geometry, keep placement) + "De-overlap only".

### Phase 2 — Power-user UX
- ⬜ **P2.1 Command palette (Ctrl/Cmd-K)** — name→struct, smart-select, style,
  export, clean-up.
- ⬜ **P2.2 Smart selection** — aromatic rings / carbonyls / heteroatoms /
  stereocenters via RDKit substructure (SMARTS we author).
- ⬜ **P2.3 Nicknames hover-expand** — our own `nicknames.json` (curated, e.g.
  Boc/Fmoc/Cbz/TBS/TBDMS/Ts/Bn/Ac/MOM/TIPS + amino acids + solvents) with
  collapsed display, correct MW, hover preview.

### Phase 3 — Output & offline
- ⬜ **P3.1 Export** — SVG (vector), PNG (any DPI) via Ketcher; PDF wrapper.
- ⬜ **P3.2 Journal style presets** — our own JSON presets (bond length, line
  width, font) for a few common styles; one-click apply. Authored, not decoded
  from `.cds`.
- ⬜ **P3.3 PWA** — manifest + service worker, offline-first.

### Phase 4 — Integrations
- ⬜ **P4.1 PubChem/ChEMBL lookup** — public REST, "Lookup" sidebar panel.
- ⬜ **P4.2 Reaction UI + scheme auto-group / grid-lock** — arrows + reactant/
  product slots + conditions panel + atom-count balance check, PLUS the
  requested **annotation auto-grouping & lock** (see `../../../` memory
  `project-reaction-grouping-lock`):
  - Write a **compound number** below a structure and **step/conditions** on an
    arrow; these **auto-associate** with their molecule/arrow by proximity
    ("this text belongs to this molecule") — no manual grouping (ChemDraw makes
    you Group manually; auto-grouping is our innovation).
  - A **lock toggle (lock symbol)**: locked → everything snaps to a grid with
    even spacing, multi-step rows stay aligned, and a molecule + its labels move
    together (re-snap/re-place on drop, since Ketcher owns live dragging).
    Unlocked → free placement, no grouping.
  - Builds on the existing caption-by-proximity system (P1.1/P1.4). Pairs with
    P1.4's grid layout. Hover-highlight of a molecule's associated labels.
- ⬜ **P4.3 ML gateway client (Tier 1)** — REST client + graceful degrade +
  mock gateway + `docker-compose` docs. No models run here.

### Deferred (need infra/decision) ⏸
- 40 MB PubChem trivial-name DB (heavy download) → replaced by P1.3 curated map
- Cross-machine Yjs collaboration (needs signaling/relay) → revisit later
- Tier 1 actual models: Molecular Transformer / AiZynthFinder / STOUT / DECIMER
- JS plugin API (iframe workers)
- HELM biopolymers

## Execution order
Done: ✅ P1.1, ✅ P1.2, ✅ P1.4.
Next: P2.2 (smart selection) → P2.1 (command palette) → P3.1 (export) →
P2.3 (nicknames) → P3.3 (PWA) → P3.2 (journal styles) → P4.1 (lookup) →
P4.2 (reaction UI + scheme auto-group/lock) → P4.3 (ML gateway).
P1.3 (structure→name) parked pending the approach decision.
Each ships as its own tested commit.
