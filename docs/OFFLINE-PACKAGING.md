# Offline / Desktop (.exe) Packaging — Network Dependencies & Preload Requirement

> **Status:** design note, NOT yet implemented. Read this before packaging
> DChemInk as a desktop app (Electron / Tauri) or shipping it for offline use.

## The concern (answered)

Some features send a request to **PubChem** (a public web service) and use the
response. If the user is **offline**, those features cannot work. If we ship a
`.exe` for offline use, we MUST bundle local replacements (a "preloaded"
name↔structure resolver). This document records that requirement.

## Which features need the network vs work fully offline

| Feature | Needs internet? | Why |
|---|---|---|
| Drawing, editing, hotkeys | ❌ offline | Ketcher runs in-app |
| Properties (MW, logP, TPSA, …) | ❌ offline | RDKit-JS (WASM) runs locally |
| File import/export (MOL/SMILES/CDXML/SVG/PNG) | ❌ offline | local |
| Smart selection, command palette, nicknames | ❌ offline | local |
| **Name → structure** (the "Name" box) | ✅ **online** | calls PubChem |
| **Paste a chemical name** onto canvas | ✅ **online** | calls PubChem |
| Compound lookup (PubChem/ChEMBL) — planned | ✅ online | by definition |

So today, **two** features (and one planned one) break offline: typing/pasting a
*name* to get a structure. Everything else already works with no internet.

## Online latency (measured)

PubChem name→SMILES round-trip, measured from this machine:

| Compound | Time |
|---|---|
| aspirin | 0.71 s |
| ibuprofen | 0.65 s |
| caffeine | 0.66 s |
| acetylsalicylic acid | 0.66 s |
| paracetamol | 0.69 s |

- **Typical: ~0.6–0.7 s** on a good connection. Expect **0.5–1.5 s** for end
  users; slower (2–4 s) on poor links or when PubChem is under load.
- **Rate limits (PubChem policy):** ≤ 5 requests/second and ≤ 400/minute per IP.
  Fine for interactive typing; relevant only for bulk use.
- We already show a `Resolving "…"` toast so the ~1 s wait is visible, and an
  error toast if the name isn't found or the network fails.

## Required for an offline `.exe`: PRELOAD a local resolver

To make name↔structure work without internet, bundle these **inside** the
package and resolve locally first, only falling back to PubChem if online:

1. **OPSIN (offline, systematic IUPAC → structure).** OPSIN (MIT) converts
   systematic names ("2-bromopropane", "1-chloro-4-nitrobenzene") to structures
   with no network. It's a Java library; in a desktop shell we can bundle it as
   a sidecar process (ship a small JRE) or use a compiled WASM/JS build. This
   covers the large majority of systematic names instantly and offline.
2. **Curated trivial-name table (preloaded).** A local map of common/trivial
   names → SMILES (e.g. aspirin, caffeine, the top few-thousand drug-like
   names), shipped as a bundled SQLite/JSON/IndexedDB seed. Covers names OPSIN
   can't parse (brand/trivial names). **This is the "preloaded" data we must
   add** — authored from open data (our own original work).
3. **Resolver order:** local OPSIN → local trivial table → (PubChem **only if**
   the app detects connectivity). The same `resolveName` interface we already
   have stays; we just add local providers ahead of PubChem.

### Structure → name, offline
Mirror image: ship a local trivial-name reverse map + rule-based naming
(OpenChemLib) offline; the heavier transformer (STOUT) stays an optional
online/Tier-1 add-on.

## Packaging notes (when we get there)
- **Tauri** (Rust shell, ~3–10 MB) or **Electron** (~80–120 MB). Tauri keeps the
  installer small; either can bundle the WASM assets and a sidecar.
- Bundle size drivers: Ketcher (~24 MB JS) + RDKit WASM + the trivial-name seed
  (a few MB if curated; do NOT ship the full 40 MB PubChem dump unless needed).
- Mark it a PWA too (offline-first service worker) so the *web* build also works
  offline for everything except the online-only lookups.

## TODO before an offline release
- [ ] Add local OPSIN provider (bundled) to the `resolveName` chain.
- [ ] Author + bundle the curated trivial-name seed (open-data sourced).
- [ ] Connectivity detection → only call PubChem when online.
- [ ] Decide Tauri vs Electron; wire the build.
- [ ] Document for end users which (if any) features still need internet.
