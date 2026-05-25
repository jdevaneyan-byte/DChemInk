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
- 🟡 **P1.3 Structure → name** — our own algorithmic IUPAC engine (option c),
  offline, original work re-derived from the public IUPAC recommendations.
  **Acyclic + monocyclic coverage is complete and PubChem/OPSIN-audited
  (Tiers 1–3 + T4 Stage 1 below).** Remaining: **T4 Stage 2+** fused/bridged/spiro
  ring systems, general heterocycles (Hantzsch–Widman beyond the curated table);
  **T5** stereodescriptors (R/S, E/Z). Anything
  out-of-scope returns "not yet supported — <reason>" (never a wrong name).
  - **Tier 1 shipped:** acyclic hydrocarbons (chain selection, lowest-locant
    numbering, alkyl substituents, di/tri multipliers, ene/yne).
  - **Tier 2 shipped (functional groups + seniority):** carboxylic acid, amide,
    nitrile, aldehyde, ketone, alcohol, amine as suffix groups; halogens,
    ethers (alkoxy), nitro as always-prefix groups; PCG-priority chain
    selection/numbering; multiplicative suffixes (-diol, -dione, -dioic acid,
    -dial, -diamine, -dinitrile); 'e'-elision rules. PubChem-corpus-validated.
    Plans in `p1.3-tier2-implementation.md` + `p1.3-tier2-design.md`.
  - **✅ Tier 2b shipped (acid derivatives):** esters (`ethyl ethanoate`),
    acyl halides (`ethanoyl chloride`), anhydrides (`ethanoic anhydride`,
    `ethanoic propanoic anhydride`), and diacyl dihalides (`butanedioyl
    dichloride`). Two-part / functional-class names; seniority below acid,
    above amide. OPSIN round-trip audited (1000 molecules, 100% match).
    PubChem cross-checked: systematic PINs used (retained names noted).
  - **✅ Tier 3 shipped (monocyclic rings):** carbocycles (cyclopropane →
    cyclooctane), benzene with mandatory retained PINs (phenol, aniline,
    toluene, styrene, benzoic acid, benzaldehyde, benzonitrile, benzamide),
    22 common heterocycles (pyridine, furan, thiophene, pyrrole, pyrimidine,
    pyrazine, pyridazine, piperidine, pyrrolidine, morpholine, piperazine,
    oxolane, oxane, thiolane, thiane, …), ring-as-substituent (phenyl prefix),
    added-carbon suffixes (-carboxylic acid, -carbaldehyde, -carbonitrile,
    -carboxamide). Pure-TS ring fingerprint; ring vs chain PCG parent selection.
    OPSIN round-trip audited: 1000+ molecules, 100% match; PLUS a PubChem
    name-string audit (round-trip only checks structure, not preferred name)
    that fixed ring-substituent locant tie-breaks, substituted-ring suffix
    locants (4-methylcyclohexan-1-ol), and declined tautomeric pyridinones.
  - **✅ Tier 4 Stage 1 shipped (cyclic carbonyls):** saturated lactams
    (azetidin-2-one, pyrrolidin-2-one, piperidin-2-one, azepan-2-one), saturated
    lactones (oxetan-2-one, oxolan-2-one, oxan-2-one), and aromatic ring
    carbonyls (pyridin-2(1H)-one, pyridin-4(1H)-one, 2H-pyran-2-one,
    pyrimidine-2,4(1H,3H)-dione/uracil). OPSIN round-trip + PubChem-audited; 0
    mismatches. Non-tabled or fused-ring carbonyls declined (no wrong names).
    7+-membered or non-tabled heterocycles remain DECLINED to T4 Stage 2 (not mis-named).
  - **✅ Tier 4 Stage 3 shipped (von Baeyer bridged ring systems):** bicyclo[a.b.c]alkane
    naming for all standard bicyclics (norbornane bicyclo[2.2.1]heptane,
    bicyclo[2.2.2]octane, bicyclo[1.1.1]pentane, bicyclo[3.2.2]nonane, etc.);
    heteroatom replacement (aza/oxa/thia with correct locants: quinuclidine
    1-azabicyclo[2.2.2]octane, DABCO 1,4-diazabicyclo[2.2.2]octane, 2-oxa/2-thia
    variants); ene-suffix for bridged unsaturated systems (norbornene
    bicyclo[2.2.1]hept-2-ene); curated adamantane fingerprint recognition.
    General tricyclic+ (non-adamantane), spiro, and ring assemblies remain DECLINED.
    OPSIN round-trip audited: 12 bridged names parsed → structural identity confirmed;
    2 e2e tests (norbornane, quinuclidine) full SMILES→name→OPSIN→canonical-key round-trip.
    PubChem-verified before every assertion. 0 wrong names.
  - **✅ Tier 4 Stage 4 shipped (monospiro ring systems):** carbocyclic spiro
    (spiro[2.2]pentane, spiro[3.3]heptane, spiro[4.4]nonane, spiro[4.5]decane,
    spiro[5.5]undecane), heteroatom replacement (1-oxa/1,4-dioxa/1-aza, with
    lowest locants — incl. the equal-ring case where the heteroatom-bearing ring
    is numbered first: 1-oxaspiro[5.5]undecane, 1-azaspiro[4.4]nonane), and
    substituents/unsaturation/suffix groups (-ol, -one, -amine) numbered per the
    spiro numbering. Emits IUPAC PREFERRED (lowest) locants; where PubChem's
    namer prints a higher symmetric-equivalent locant (e.g. spiro[4.5]decan-2-one
    vs PubChem's -3-one) we print the lower, matching the IUPAC rule and ChemDraw.
    19-case OPSIN round-trip audit (structural identity confirmed) + 2 e2e
    (spiro[4.5]decane, 1,4-dioxaspiro[4.5]decane). PubChem-verified before every
    assertion. Dispiro/polyspiro and ring-heteroatom+suffix-carbonyl lactones
    DECLINE (no wrong names). General fusion (decalin/Hantzsch-Widman) remains
    DECLINED to Stage 5.
  - Engine in `src/chem/naming/` (pure-TS rules engine ← `MolGraph` ← RDKit
    perception adapter), live "IUPAC" row in the Properties panel, transparent
    "not yet supported — <reason>" for out-of-tier molecules. Tier staircase
    (T3 rings → T4 polycyclic/heterocyclic → T5 stereo) in
    `p1.3-iupac-naming-design.md`. OPSIN round-trip "✓ verified" badge
    deferred (`opsin-js` not published to npm).
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
P1.3 in progress: Tier 1 (acyclic) ✅ done; Tier 2 (functional groups) ✅ done;
Tier 2b (acid derivatives: ester/acyl halide/anhydride) ✅ done (OPSIN-audited, 100% round-trip).
P1.3: Tiers 1–3 ✅ (acyclic + functional groups + acid derivatives + monocyclic
rings/heterocycles); T4 Stage 1 ✅ (cyclic carbonyls: lactams, lactones, aromatic
ring-carbonyls/pyridinones); T4 Stage 2 ✅ (fused aromatic/heteroaromatic ring
systems: naphthalene, quinoline, indole, purine, anthracene, phenanthrene + substituted
variants); T4 Stage 3 ✅ (von Baeyer bridged ring systems: bicyclo[a.b.c]alkanes,
heteroatom replacement, ene suffix, curated adamantane); T4 Stage 4 ✅
(monospiro ring systems: carbocyclic + heteroatom replacement + substituents/
suffixes, IUPAC lowest locants).
Remaining (ordering decided 2026-05-25): **T5 (stereo: R/S, E/Z) NEXT**, then
**T4 Stage 5** (decalin/fused-saturated, general Hantzsch–Widman) as the final
naming task before Phase 2. Rationale: the 5000-structure audit confirmed
Stage-5 systems DECLINE safely (no wrong names), so Stage 5 is added coverage,
not a correctness gap; stereo affects far more everyday structures. T5 design:
`p1.3-tier5-stereo-design.md` (uses RDKit CIP via get_stereo_tags).
Next: Tier 3 (rings) → then P2.2 (smart selection) → P2.1
(command palette) → P3.1 (export) → P2.3 (nicknames) → P3.3 (PWA) →
P3.2 (journal styles) → P4.1 (lookup) → P4.2 (reaction UI + auto-group/lock)
→ P4.3 (ML gateway).
Each ships as its own tested commit.
