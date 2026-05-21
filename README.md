# DChemInk

Open-source web-based chemistry drawing tool. Browser-only. No backend, no AI, no fees.

![DChemInk v0.3 — hotkey help + file import + live properties](docs/screenshot-v0.3.png)

## Built with (and grateful to)

DChemInk is a thin, original UI layer built on top of outstanding open-source
projects. It would not exist without them:

- **[Ketcher](https://github.com/epam/ketcher)** — © EPAM Systems, **Apache-2.0**.
  The 2D molecule editor at the core of DChemInk (embedded unmodified). 🙏
- **[RDKit](https://github.com/rdkit/rdkit) / [RDKit-JS](https://github.com/rdkit/rdkit-js)**
  — © Greg Landrum & the RDKit contributors, **BSD-3-Clause**. In-browser
  cheminformatics (formula, descriptors, canonical SMILES).
- **[PubChem](https://pubchem.ncbi.nlm.nih.gov/)** (NCBI/NIH) — public-domain
  data, used for name → structure resolution.
- **React** (MIT), **Vite** (MIT), **TypeScript** (Apache-2.0), **Tailwind CSS**
  (MIT), **Geist font** (OFL-1.1).

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for full credits and
license texts.

## Develop

```bash
pnpm install
pnpm dev               # http://localhost:5173
pnpm test              # unit tests (Vitest)
pnpm test:e2e          # Playwright E2E
pnpm build             # production bundle
```

## v0.3 — polish + file import

- **File import** — "Open file…" button in the sidebar accepts CDXML, MOL, SDF, SMILES, InChI, KET. Ketcher sniffs the format automatically.
- **Bundle code-splitting** — Ketcher, RDKit, and React are now isolated chunks. App updates no longer bust Ketcher's 24 MB cache.
- **Cleaner deps** — dropped 7 scaffold leftovers (shadcn, radix-ui, lucide-react, class-variance-authority, clsx, tailwind-merge, tw-animate-css). Removed ~4,000 lines of lockfile churn.

## v0.2 — keyboard-driven editing

Single-key atom editing. Press `?` for the searchable hotkey overlay (the bindings are defined in `src/hotkeys/hotkeys.json`).

- **LABELTEXT** — `m` → Me, `e` → Et, `P` → Ph, `H` → Cbz, `Q` → Fmoc, `y` → Boc, … Select an atom, press the key; label round-trips through CXSMILES.
- **SPROUT** — `3` → benzene, `6` → cyclohexane, `7` → cyclopentane, `2` → carbonyl, `J` → phenyl. v0.2 adds the substructure as a separate fragment; bonded sprouts come in v0.4.

## v0.1 — scaffold

Vite + React + TS + Ketcher 2D canvas + RDKit-JS + live PropertiesPanel (MW / formula / exact mass).

## License

DChemInk's own source code is licensed under the **MIT License** — see
[`LICENSE`](LICENSE).

Bundled third-party components keep their own licenses (Ketcher = Apache-2.0,
RDKit-JS = BSD-3-Clause, …) — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
These are not relicensed by DChemInk.
