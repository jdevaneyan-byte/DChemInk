# Third-Party Notices & Acknowledgements

DChemInk stands on the shoulders of excellent open-source chemistry and web
projects. Each component below keeps its own license and copyright — they are
**not** relicensed by DChemInk's MIT license. We're grateful to their authors.

If you redistribute DChemInk's built bundle, retain these notices.

---

## Core chemistry & drawing

### Ketcher  ⭐ (the molecule editor at the heart of DChemInk)
- **Copyright** © EPAM Systems / EPAM Life Sciences
- **License:** Apache License 2.0
- **Project:** https://github.com/epam/ketcher · https://lifescience.opensource.epam.com/ketcher
- Used as the 2D structure-drawing canvas (`ketcher-core`, `ketcher-react`,
  `ketcher-standalone`). DChemInk embeds Ketcher unmodified via npm and adds its
  own UI/hotkeys/property layer around it. **Huge thanks to the Ketcher team.**

### RDKit / RDKit-JS
- **Copyright** © Greg Landrum and the RDKit contributors
- **License:** BSD 3-Clause
- **Project:** https://github.com/rdkit/rdkit · https://github.com/rdkit/rdkit-js
- Provides cheminformatics in the browser (WASM): molecular formula, weights,
  descriptors (logP, TPSA, HBD/HBA, rings, …), and canonical SMILES.

## Naming / data services

### PubChem (NCBI / NIH)
- **Public domain** U.S. Government data, via the free PUG REST API.
- **Service:** https://pubchem.ncbi.nlm.nih.gov/
- Used for name → structure resolution. Please follow PubChem's usage policy
  (≤ 5 requests/second).

### OPSIN *(planned, offline name→structure)*
- **Copyright** © Daniel Lowe and contributors · **License:** MIT
- **Project:** https://github.com/dan2097/opsin

## Web framework & tooling
| Component | Copyright | License |
|---|---|---|
| React, React-DOM | © Meta Platforms, Inc. | MIT |
| Vite | © VoidZero / Vite contributors | MIT |
| TypeScript | © Microsoft Corporation | Apache-2.0 |
| Tailwind CSS | © Tailwind Labs, Inc. | MIT |
| Vitest, Playwright | their respective authors | MIT / Apache-2.0 |

## Fonts
### Geist (`@fontsource-variable/geist`)
- **Copyright** © Vercel, Inc.
- **License:** SIL Open Font License 1.1

---

Full license texts are available in each package under `node_modules/<pkg>/`
(e.g. `node_modules/ketcher-core/LICENSE`) and at the project links above. If
you believe an attribution is missing or incorrect, please open an issue.
