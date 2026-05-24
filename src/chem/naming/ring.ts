// src/chem/naming/ring.ts
// Task 1: single-ring perception + canonical ring fingerprint (pure TS, no RDKit)
// Task 2: ring tables (carbocycle / benzene / heterocycle) + numbering
import type { MolGraph } from "./graph";

// ────────────────────────────────────────────────────────────────────────────────
// Task 1: Ring perception
// ────────────────────────────────────────────────────────────────────────────────

export interface RingInfo {
  atoms: number[];       // ring atom indices in cyclic order
  size: number;
  aromatic: boolean;     // true when every ring bond is aromatic
  heteroatoms: number[]; // ring atom indices that are not carbon
}

/**
 * Perceive the single ring in a MolGraph.
 * Returns null when there are zero or ≥2 rings (or SSSR says so).
 *
 * Algorithm:
 *  1. Collect all atoms that belong to at least one ring (ringIds.length > 0).
 *  2. If none → null. If >1 distinct SSSR ring id used → null (multi-ring).
 *  3. Walk the ring bonds to produce a cyclic atom ordering.
 *  4. Detect aromaticity from bond flags.
 */
export function perceiveRing(graph: MolGraph): RingInfo | null {
  // Gather distinct ring ids used across all atoms
  const distinctRingIds = new Set<number>();
  for (const a of graph.atoms) {
    for (const r of a.ringIds) distinctRingIds.add(r);
  }

  // 0 rings → null
  if (distinctRingIds.size === 0) return null;
  // ≥2 rings → multi-ring → null  (Tier 4)
  if (distinctRingIds.size > 1) return null;

  // Exactly 1 SSSR ring. Collect its member atom indices.
  const ringAtomIndices = new Set<number>();
  for (const a of graph.atoms) {
    if (a.ringIds.length > 0) ringAtomIndices.add(a.index);
  }

  // Build adjacency restricted to ring atoms ↔ ring bonds
  const ringAdj = new Map<number, number[]>();
  for (const idx of ringAtomIndices) ringAdj.set(idx, []);

  const ringBonds: { from: number; to: number; aromatic: boolean }[] = [];
  for (const b of graph.bonds) {
    if (ringAtomIndices.has(b.from) && ringAtomIndices.has(b.to)) {
      ringAdj.get(b.from)!.push(b.to);
      ringAdj.get(b.to)!.push(b.from);
      ringBonds.push({ from: b.from, to: b.to, aromatic: b.aromatic });
    }
  }

  // Walk cycle to get atoms in cyclic order
  const cycleAtoms = walkCycle(ringAdj, ringAtomIndices);
  if (!cycleAtoms) return null;

  // Aromaticity: RDKit emits Kekulé bonds (order 1/2), not aromatic (bo=12), for
  // aromatic rings in CommonChem JSON. Detect aromaticity by checking if the ring
  // has alternating single/double bonds consistent with a conjugated π system.
  // For a ring of size n, Kekulé aromaticity = floor(n/2) double bonds in the ring.
  // Additionally verify no sp3-consistent H count (every ring C should have ≤1 H).
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));
  const ringDoubleBonds = ringBonds.filter((b) => {
    // Find the actual bond order from graph.bonds
    const bond = graph.bonds.find(
      (gb) => (gb.from === b.from && gb.to === b.to) || (gb.from === b.to && gb.to === b.from),
    );
    return bond && bond.order === 2;
  });
  const n2 = cycleAtoms.length;
  const expectedDoubleBonds = Math.floor(n2 / 2);
  // For a 5-membered ring with one heteroatom (furan/pyrrole/thiophene): 2 double bonds
  // For benzene/pyridine (6-membered): 3 double bonds
  // Check: # double bonds == floor(n/2) AND every non-heteroatom ring atom has exactly 1 H
  // (which distinguishes sp2 from sp3 ring atoms)
  const allSp2 = cycleAtoms.every((idx) => {
    const a = atomById.get(idx);
    if (!a) return false;
    // sp2 ring atoms: C has 0 or 1 H (not 2); N in pyridine has 0 H; pyrrole N has 1 H (max)
    // sp3 ring atoms: C has 2 H; N in piperidine has 1 H but also contributes to saturation
    // We distinguish pyrrole-N (aromatic, 1H) vs piperidine-N (sp3, 1H) by double-bond count
    if (a.element === "C") return a.hydrogens <= 1;
    // N in aromatic rings: pyridine-type N has 0 H; pyrrole-type N has 1 H (lone pair in ring)
    // piperidine N (sp3) also has 1 H — must distinguish by checking double bonds
    if (a.element === "N") return a.hydrogens <= 1; // both pyridine-N and pyrrole-N qualify
    if (a.element === "O") return a.hydrogens === 0; // aromatic O (furan) has 0 H
    if (a.element === "S") return a.hydrogens === 0; // aromatic S (thiophene) has 0 H
    return true;
  });
  const aromatic = ringDoubleBonds.length === expectedDoubleBonds && allSp2;

  // Heteroatoms
  const heteroatoms = cycleAtoms.filter((idx) => {
    const a = atomById.get(idx);
    return a && a.element !== "C";
  });

  return {
    atoms: cycleAtoms,
    size: cycleAtoms.length,
    aromatic,
    heteroatoms,
  };
}

/** Walk the ring adjacency to produce atoms in cyclic order. */
function walkCycle(
  adj: Map<number, number[]>,
  atomSet: Set<number>,
): number[] | null {
  if (atomSet.size === 0) return null;
  const start = [...atomSet][0];
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let current = start;
  let prev = -1;

  for (let step = 0; step < atomSet.size - 1; step++) {
    const neighbors = (adj.get(current) ?? []).filter(
      (n) => n !== prev && atomSet.has(n),
    );
    // In a cycle each ring atom has exactly 2 ring neighbors
    // Pick the unvisited neighbor (or if all visited, the one not prev)
    const next = neighbors.find((n) => !visited.has(n));
    if (!next) return null; // shouldn't happen for a simple cycle
    path.push(next);
    visited.add(next);
    prev = current;
    current = next;
  }

  // Verify closure: last atom connects back to start
  if (!(adj.get(current) ?? []).includes(start)) return null;

  return path;
}

// ────────────────────────────────────────────────────────────────────────────────
// Ring fingerprint (canonical, rotation/reflection invariant, substituents ignored)
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Build a canonical ring fingerprint from the ring's atoms and bonds only
 * (substituents are ignored). The fingerprint is the lexicographically smallest
 * string among all rotations and both directions of the per-atom
 * "(element,aromatic)" tuple interleaved with bond-order values.
 *
 * For aromatic rings (ring.aromatic=true), all ring bond orders are normalized
 * to "ar" to avoid Kekulé-variant sensitivity. For non-aromatic rings, actual
 * bond orders (1/2/3) are used.
 *
 * Format: atom0:bond01:atom1:bond12:…:atomN-1:bondN-1,0
 * where each atom token = "element,aroBit" and bond token = "1"/"2"/"3"/"ar".
 */
export function ringFingerprint(graph: MolGraph, ring: RingInfo): string {
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));

  // Per-atom tokens: "Element,aromaticBit"
  // Use derived ring.aromatic (not atom.aromatic which is always false from adapter)
  const aroBit = ring.aromatic ? 1 : 0;
  const atomToken = (idx: number): string => {
    const a = atomById.get(idx)!;
    return `${a.element},${aroBit}`;
  };

  // Bond token between two ring atoms
  const bondToken = (a: number, b: number): string => {
    if (ring.aromatic) return "ar"; // normalize all ring bonds for aromatic rings
    for (const bond of graph.bonds) {
      if ((bond.from === a && bond.to === b) || (bond.from === b && bond.to === a)) {
        return String(bond.order);
      }
    }
    return "1";
  };

  const n = ring.size;
  const atoms = ring.atoms;

  // Build atom tokens and bond tokens in the ring's current cyclic order
  const atomTokens = atoms.map(atomToken);
  // bondTokens[i] = bond between atoms[i] and atoms[(i+1)%n]
  const bondTokensFwd = atoms.map((a, i) => bondToken(a, atoms[(i + 1) % n]));
  // For reverse direction: bondTokens[i] = bond between atoms[i] and atoms[(i-1+n)%n]
  // which is the same physical bond as bondTokensFwd[(i-1+n)%n]

  // Generate all rotations × 2 directions and pick lexicographically smallest
  let best: string | null = null;
  for (let start = 0; start < n; start++) {
    // Forward direction: atoms[start], atoms[start+1], ..., atoms[start+n-1]
    {
      const segments: string[] = [];
      for (let i = 0; i < n; i++) {
        const pos = (start + i) % n;
        segments.push(atomTokens[pos]);
        // Bond from atoms[pos] to atoms[(pos+1)%n]
        segments.push(bondTokensFwd[pos]);
      }
      const candidate = segments.join(":");
      if (best === null || candidate < best) best = candidate;
    }
    // Reverse direction: atoms[start], atoms[start-1], ..., atoms[start-n+1]
    {
      const segments: string[] = [];
      for (let i = 0; i < n; i++) {
        const pos = ((start - i) % n + n) % n;
        segments.push(atomTokens[pos]);
        // Bond from atoms[pos] to atoms[(pos-1+n)%n], which is bondTokensFwd[(pos-1+n)%n]
        segments.push(bondTokensFwd[((pos - 1) % n + n) % n]);
      }
      const candidate = segments.join(":");
      if (best === null || candidate < best) best = candidate;
    }
  }
  return best!;
}

// ────────────────────────────────────────────────────────────────────────────────
// Task 2: Ring tables + numbering
// ────────────────────────────────────────────────────────────────────────────────

export interface RingNaming {
  parent: string;                   // "cyclohexane" | "benzene" | "pyridine" | retained
  locantOf: Map<number, number>;    // ring atom index → IUPAC locant
  kind: "carbocycle" | "benzene" | "heterocycle";
  retainedAromatic?: string;        // when a retained benzene parent applies
}

// ── Carbocycle stems ──────────────────────────────────────────────────────────

const CYCLO_STEMS: Record<number, string> = {
  3: "cyclopropane",
  4: "cyclobutane",
  5: "cyclopentane",
  6: "cyclohexane",
  7: "cycloheptane",
  8: "cyclooctane",
  9: "cyclononane",
  10: "cyclodecane",
};

// ── Heterocycle table ─────────────────────────────────────────────────────────
// Each entry maps a ring fingerprint → { name, locant assignment }
// locantOf: given the ring atoms in the canonical fingerprint's atom order (rotation 0),
// we store the atom-token-to-locant assignment as a function of how to assign
// locants to the ring atoms returned by perceiveRing.
//
// Rather than storing fingerprints literally (which depend on atom ordering),
// we store the defining ring composition and aromaticity, then match
// using element multisets + aromaticity.

interface HeteroEntry {
  /** Retained IUPAC name */
  name: string;
  /** Ring size */
  size: number;
  /** Aromaticity */
  aromatic: boolean;
  /**
   * Element sequence of the ring in the IUPAC-canonical atom order (heteroatom(s)
   * first). Length = size. Used together with the ring fingerprint for matching.
   * We store multiple valid starting sequences (for rings with multiple heteroatoms
   * in different positions).
   */
  elementSeqs: string[][];
  /**
   * Locant assignment in the IUPAC convention: the atom at elementSeqs[0][0]
   * gets locant 1, elementSeqs[0][1] gets locant 2, etc.
   * (All elementSeqs share the same locant logic, since they're rotations of each other.)
   */
}

// Aromatic heterocycles
// pyridine: N at position 1 in a 6-membered aromatic ring
const HETERO_TABLE: HeteroEntry[] = [
  // ── Aromatic 6-membered (one N) ──
  {
    name: "pyridine",
    size: 6,
    aromatic: true,
    elementSeqs: [["N", "C", "C", "C", "C", "C"]],
  },
  // ── Aromatic 6-membered (two N) ──
  {
    name: "pyrimidine",
    size: 6,
    aromatic: true,
    // N at 1,3: N-C-N-C-C-C
    elementSeqs: [["N", "C", "N", "C", "C", "C"]],
  },
  {
    name: "pyrazine",
    size: 6,
    aromatic: true,
    // N at 1,4: N-C-C-N-C-C
    elementSeqs: [["N", "C", "C", "N", "C", "C"]],
  },
  {
    name: "pyridazine",
    size: 6,
    aromatic: true,
    // N at 1,2: N-N-C-C-C-C
    elementSeqs: [["N", "N", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one O) ──
  {
    name: "furan",
    size: 5,
    aromatic: true,
    elementSeqs: [["O", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one S) ──
  {
    name: "thiophene",
    size: 5,
    aromatic: true,
    elementSeqs: [["S", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (one N) ──
  {
    name: "pyrrole",
    size: 5,
    aromatic: true,
    elementSeqs: [["N", "C", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (N at 1 + N at 3 = imidazole) ──
  {
    name: "imidazole",
    size: 5,
    aromatic: true,
    // IUPAC numbering: N(1)-C-N(3)-C-C  [1,3-N arrangement]
    elementSeqs: [["N", "C", "N", "C", "C"]],
  },
  // ── Aromatic 5-membered (N at 1 + N at 2 = pyrazole) ──
  {
    name: "pyrazole",
    size: 5,
    aromatic: true,
    // N(1)-N(2)-C-C-C
    elementSeqs: [["N", "N", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (O at 1 + N at 3 = oxazole) ──
  {
    name: "oxazole",
    size: 5,
    aromatic: true,
    // O(1)-C-N(3)-C-C
    elementSeqs: [["O", "C", "N", "C", "C"]],
  },
  // ── Aromatic 5-membered (O at 1 + N at 2 = isoxazole) ──
  {
    name: "isoxazole",
    size: 5,
    aromatic: true,
    // O(1)-N(2)-C-C-C
    elementSeqs: [["O", "N", "C", "C", "C"]],
  },
  // ── Aromatic 5-membered (S at 1 + N at 3 = thiazole) ──
  {
    name: "thiazole",
    size: 5,
    aromatic: true,
    // S(1)-C-N(3)-C-C
    elementSeqs: [["S", "C", "N", "C", "C"]],
  },
  // ── Mancude 6-membered (O) = pyran — used for 2H-pyran-2-one parent lookup ──
  // "Pyran" itself is not a stable aromatic compound but the aromatic fingerprint
  // [O,ar,C,ar,...] is used in nameAromaticRingCarbonyl for pyranone naming.
  // We store it with aromatic=true so the forced-aromatic ring lookup finds it.
  {
    name: "pyran",
    size: 6,
    aromatic: true,
    elementSeqs: [["O", "C", "C", "C", "C", "C"]],
  },

  // ── Saturated 3-membered ──
  {
    name: "aziridine",
    size: 3,
    aromatic: false,
    elementSeqs: [["N", "C", "C"]],
  },
  {
    name: "oxirane",
    size: 3,
    aromatic: false,
    elementSeqs: [["O", "C", "C"]],
  },
  // ── Saturated 4-membered ──
  {
    name: "azetidine",
    size: 4,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one N) ──
  {
    name: "pyrrolidine",
    size: 5,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one O) = oxolane (tetrahydrofuran) ──
  {
    name: "oxolane",
    size: 5,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C"]],
  },
  // ── Saturated 5-membered (one S) = thiolane ──
  {
    name: "thiolane",
    size: 5,
    aromatic: false,
    elementSeqs: [["S", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one N) ──
  {
    name: "piperidine",
    size: 6,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one O) = oxane (tetrahydropyran) ──
  {
    name: "oxane",
    size: 6,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (one S) = thiane ──
  {
    name: "thiane",
    size: 6,
    aromatic: false,
    elementSeqs: [["S", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 6-membered (N + O at 1,4) = morpholine ──
  {
    name: "morpholine",
    size: 6,
    aromatic: false,
    // O(1)-C-N(3)... wait — morpholine: O at 1, N at 4: O-C-C-N-C-C
    elementSeqs: [["O", "C", "C", "N", "C", "C"]],
  },
  // ── Saturated 6-membered (N + N at 1,4) = piperazine ──
  {
    name: "piperazine",
    size: 6,
    aromatic: false,
    // N at 1 and 4: N-C-C-N-C-C
    elementSeqs: [["N", "C", "C", "N", "C", "C"]],
  },
  // ── Saturated 4-membered (one O) = oxetane ──
  {
    name: "oxetane",
    size: 4,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C"]],
  },
  // ── Saturated 7-membered (one N) = azepane ──
  {
    name: "azepane",
    size: 7,
    aromatic: false,
    elementSeqs: [["N", "C", "C", "C", "C", "C", "C"]],
  },
  // ── Saturated 7-membered (one O) = oxepane ──
  {
    name: "oxepane",
    size: 7,
    aromatic: false,
    elementSeqs: [["O", "C", "C", "C", "C", "C", "C"]],
  },
];

/**
 * Given the ring's element sequence (in cyclic order) and aromaticity,
 * find the matching heterocycle entry if any.
 * Returns { entry, startIdx, forward } where startIdx is the index in
 * ring.atoms where locant 1 is assigned, and forward is the direction.
 */
function matchHeterocycle(
  ring: RingInfo,
  graph: MolGraph,
): { entry: HeteroEntry; startIdx: number; forward: boolean } | null {
  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));
  const n = ring.size;
  const elements = ring.atoms.map((idx) => atomById.get(idx)!.element);

  for (const entry of HETERO_TABLE) {
    if (entry.size !== n || entry.aromatic !== ring.aromatic) continue;

    // Try to match any elementSeq against the ring (rotations + both directions)
    for (const seq of entry.elementSeqs) {
      // Try all starting positions and both directions
      for (let start = 0; start < n; start++) {
        for (const fwd of [true, false]) {
          let matches = true;
          for (let i = 0; i < n; i++) {
            const pos = fwd
              ? (start + i) % n
              : ((start - i) % n + n) % n;
            if (elements[pos] !== seq[i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            return { entry, startIdx: start, forward: fwd };
          }
        }
      }
    }
  }
  return null;
}

/**
 * For a carbocycle (no heteroatoms), assign ring atom → IUPAC locant
 * minimizing the locant set for: PCG carbons > double-bond locants > substituent locants.
 * Returns a map from ring atom index → locant.
 *
 * opts.pcgAtoms: set of ring atom indices that carry the PCG
 * opts.unsatBonds: pairs [a,b] of ring atom indices that are double/triple bonds
 * opts.subAtoms: set of ring atom indices that have substituents
 * opts.subAlphaKeys: map ring atom index → alphabetization key of its substituent
 *   (used for the final IUPAC tie-break: alphabetically-first substituent gets lowest locant)
 */
function assignCarbocycleLocants(
  ring: RingInfo,
  opts: {
    pcgAtoms?: Set<number>;
    unsatBonds?: [number, number][];
    subAtoms?: Set<number>;
    subAlphaKeys?: Map<number, string>;
  } = {},
): Map<number, number> {
  const n = ring.size;
  const { pcgAtoms, unsatBonds = [], subAtoms, subAlphaKeys } = opts;

  // We try all starting positions and both directions, pick best by priority ladder
  let bestMap: Map<number, number> | null = null;
  let bestPcg: number[] = [];
  let bestUnsat: number[] = [];
  let bestSub: number[] = [];

  for (let start = 0; start < n; start++) {
    for (const fwd of [true, false]) {
      // Build locantOf map for this orientation
      const locantOf = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const pos = fwd ? (start + i) % n : ((start - i) % n + n) % n;
        locantOf.set(ring.atoms[pos], i + 1);
      }

      // Compute priority arrays
      const pcgLocs: number[] = [];
      if (pcgAtoms) {
        for (const [atomIdx, loc] of locantOf) {
          if (pcgAtoms.has(atomIdx)) pcgLocs.push(loc);
        }
        pcgLocs.sort((a, b) => a - b);
      }

      const unsatLocs: number[] = [];
      for (const [a, b] of unsatBonds) {
        const la = locantOf.get(a)!;
        const lb = locantOf.get(b)!;
        // For ring double bonds: the locant is min(la, lb) EXCEPT when the bond
        // spans the ring-closing position {1, n} (wrap-around bond). In that case
        // the locant is n, per IUPAC convention (the "n-ene" bond, not "1-ene").
        // This prevents, e.g., cyclohexa-1,4-diene from being mislabelled 1,3-diene
        // via a backward walk that wraps the 1,4-bond across the ring closure.
        const lo = Math.min(la, lb);
        const hi = Math.max(la, lb);
        const isWrapAround = lo === 1 && hi === n;
        unsatLocs.push(isWrapAround ? n : lo);
      }
      unsatLocs.sort((a, b) => a - b);

      const subLocs: number[] = [];
      if (subAtoms) {
        for (const [atomIdx, loc] of locantOf) {
          if (subAtoms.has(atomIdx)) subLocs.push(loc);
        }
        subLocs.sort((a, b) => a - b);
      }

      // Compare to best
      if (!bestMap) {
        bestMap = locantOf;
        bestPcg = pcgLocs;
        bestUnsat = unsatLocs;
        bestSub = subLocs;
        continue;
      }

      // Priority: PCG first
      if (pcgAtoms && pcgAtoms.size > 0) {
        const cmp = compareArr(pcgLocs, bestPcg);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }
      // Then unsaturation
      {
        const cmp = compareArr(unsatLocs, bestUnsat);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }
      // Then substituents
      if (subAtoms && subAtoms.size > 0) {
        const cmp = compareArr(subLocs, bestSub);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
          continue;
        } else if (cmp > 0) {
          continue;
        }
      }

      // Alphabetical tie-break: the substituent cited first alphabetically gets
      // the lowest locant. Build a list of (alphaKey, locant) pairs sorted by key,
      // then compare locants in that alpha-sorted order.
      if (subAlphaKeys && subAlphaKeys.size > 0 && bestMap) {
        const cmp = compareByAlphaLocant(locantOf, bestMap, subAlphaKeys);
        if (cmp < 0) {
          bestMap = locantOf;
          bestPcg = pcgLocs;
          bestUnsat = unsatLocs;
          bestSub = subLocs;
        }
        // cmp >= 0: keep bestMap
      }
    }
  }

  return bestMap ?? new Map(ring.atoms.map((a, i) => [a, i + 1]));
}

function compareArr(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Alphabetical tie-break for ring numbering (IUPAC P-14.5):
 * When two orientations give the same locant set for substituents, the one where
 * the alphabetically-first substituent has the lower locant wins.
 *
 * Returns <0 if `candidate` wins over `current`, >0 if `current` wins, 0 if tied.
 */
function compareByAlphaLocant(
  candidate: Map<number, number>,
  current: Map<number, number>,
  subAlphaKeys: Map<number, string>,
): number {
  // Build sorted-by-alpha list of (key, locant) for each orientation
  function alphaLocants(locantOf: Map<number, number>): { key: string; locant: number }[] {
    const pairs: { key: string; locant: number }[] = [];
    for (const [atomIdx, alphaKey] of subAlphaKeys) {
      const loc = locantOf.get(atomIdx);
      if (loc !== undefined) pairs.push({ key: alphaKey, locant: loc });
    }
    // Sort by alpha key first, then by locant (to make comparison stable)
    pairs.sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : x.locant - y.locant);
    return pairs;
  }

  const aCand = alphaLocants(candidate);
  const aCurr = alphaLocants(current);
  const len = Math.min(aCand.length, aCurr.length);
  for (let i = 0; i < len; i++) {
    // Same alpha key at position i: compare locants (lower is better)
    if (aCand[i].key === aCurr[i].key) {
      if (aCand[i].locant !== aCurr[i].locant) {
        return aCand[i].locant - aCurr[i].locant;
      }
    }
  }
  return 0;
}

/**
 * Name the ring (carbocycle, benzene, or heterocycle) and return numbering.
 * Returns null for unsupported rings (non-tabled heterocycles, rings outside size range).
 */
export function nameRing(
  graph: MolGraph,
  ring: RingInfo,
  opts: {
    pcgAtoms?: Set<number>;
    unsatBonds?: [number, number][];
    subAtoms?: Set<number>;
    /** Map: ring atom index → alphabetization key of its substituent name.
     *  Used for the final IUPAC tie-break (alphabetically-first substituent
     *  gets the lowest locant). Only needed for carbocycles/benzene. */
    subAlphaKeys?: Map<number, string>;
  } = {},
): RingNaming | null {
  // ── Benzene (aromatic all-carbon 6-membered) ──────────────────────────────────
  if (ring.aromatic && ring.heteroatoms.length === 0 && ring.size === 6) {
    // Benzene: aromatic ring gets simple sequential locants, orientation chosen
    // to minimize PCG/substituent locants.
    const locantOf = assignCarbocycleLocants(ring, opts);
    return { parent: "benzene", locantOf, kind: "benzene" };
  }

  // ── Carbocycle (non-aromatic all-carbon) ─────────────────────────────────────
  if (ring.heteroatoms.length === 0 && !ring.aromatic) {
    const stem = CYCLO_STEMS[ring.size];
    if (!stem) return null; // size not in table (e.g. 11-membered) → Tier 4
    const locantOf = assignCarbocycleLocants(ring, opts);
    return { parent: stem, locantOf, kind: "carbocycle" };
  }

  // ── Heterocycle (match against table) ─────────────────────────────────────────
  if (ring.heteroatoms.length > 0) {
    const match = matchHeterocycle(ring, graph);
    if (!match) return null; // not in table → Tier 4

    const { entry, startIdx, forward } = match;
    const n = ring.size;

    // Build locantOf from the matched orientation
    // The IUPAC canonical numbering has locant 1 at startIdx in the forward direction
    // But we must also consider which direction minimizes PCG/substituent locants.
    // First build the "base" locant map from the matched heterocycle orientation:
    const baseLocantOf = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const pos = forward ? (startIdx + i) % n : ((startIdx - i) % n + n) % n;
      baseLocantOf.set(ring.atoms[pos], i + 1);
    }

    // For heterocycles with a unique heteroatom position (single heteroatom
    // or asymmetric arrangement), the IUPAC numbering is fixed (heteroatom = 1).
    // For symmetric cases, we need to choose the direction that minimises
    // PCG/substituent locants while keeping the heteroatom at locant 1.

    // Try both directions from the same startIdx, keeping heteroatom at 1
    // (i.e., try startIdx in forward and startIdx in reverse if the heteroatom
    // is still at locant 1 — which it is by definition, since it's the starting point).
    // Actually, the match already gives us one valid orientation.
    // We must also try the "clockwise" vs "counterclockwise" from startIdx:
    // Both assign locant 1 to the heteroatom, but differ in which way locants increase.

    const candidateMaps: Map<number, number>[] = [];
    // Try startIdx forward:
    {
      const m = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        m.set(ring.atoms[(startIdx + i) % n], i + 1);
      }
      candidateMaps.push(m);
    }
    // Try startIdx backward:
    {
      const m = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        m.set(ring.atoms[((startIdx - i) % n + n) % n], i + 1);
      }
      candidateMaps.push(m);
    }

    // For heterocycles with two heteroatoms (like pyrimidine, pyrazine, etc.),
    // there may be multiple starting positions that give the heteroatoms the lowest
    // locants. We already have the primary match; also try all rotations where
    // the element sequence matches.
    const allMatchedMaps: Map<number, number>[] = [...candidateMaps];

    // For multi-heteroatom cases, try other valid start positions that also match
    // the element sequence
    for (const seq of entry.elementSeqs) {
      const elements = ring.atoms.map((idx) => {
        const a = graph.atoms.find((atom) => atom.index === idx);
        return a?.element ?? "C";
      });
      for (let altStart = 0; altStart < n; altStart++) {
        for (const altFwd of [true, false]) {
          let matches = true;
          for (let i = 0; i < n; i++) {
            const pos = altFwd ? (altStart + i) % n : ((altStart - i) % n + n) % n;
            if (elements[pos] !== seq[i]) { matches = false; break; }
          }
          if (matches) {
            const m = new Map<number, number>();
            for (let i = 0; i < n; i++) {
              const pos = altFwd ? (altStart + i) % n : ((altStart - i) % n + n) % n;
              m.set(ring.atoms[pos], i + 1);
            }
            allMatchedMaps.push(m);
          }
        }
      }
    }

    // Pick the best map: minimize heteroatom locants, then PCG locants, then sub locants
    const heteroIdxSet = new Set(ring.heteroatoms);

    let bestMap = allMatchedMaps[0];
    let bestHeteroLocs = getLocants(bestMap, heteroIdxSet);
    let bestPcgLocs = opts.pcgAtoms ? getLocants(bestMap, opts.pcgAtoms) : [];
    let bestSubLocs = opts.subAtoms ? getLocants(bestMap, opts.subAtoms) : [];

    for (let mi = 1; mi < allMatchedMaps.length; mi++) {
      const m = allMatchedMaps[mi];
      const hLocs = getLocants(m, heteroIdxSet);
      const pLocs = opts.pcgAtoms ? getLocants(m, opts.pcgAtoms) : [];
      const sLocs = opts.subAtoms ? getLocants(m, opts.subAtoms) : [];

      let cmp = compareArr(hLocs, bestHeteroLocs);
      if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
      if (cmp > 0) continue;

      if (opts.pcgAtoms && opts.pcgAtoms.size > 0) {
        cmp = compareArr(pLocs, bestPcgLocs);
        if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
        if (cmp > 0) continue;
      }

      if (opts.subAtoms && opts.subAtoms.size > 0) {
        cmp = compareArr(sLocs, bestSubLocs);
        if (cmp < 0) { bestMap = m; bestHeteroLocs = hLocs; bestPcgLocs = pLocs; bestSubLocs = sLocs; continue; }
      }
    }

    return { parent: entry.name, locantOf: bestMap, kind: "heterocycle" };
  }

  return null;
}

function getLocants(locantOf: Map<number, number>, atomSet: Set<number>): number[] {
  const locs: number[] = [];
  for (const [idx, loc] of locantOf) {
    if (atomSet.has(idx)) locs.push(loc);
  }
  return locs.sort((a, b) => a - b);
}

/**
 * Build the ring-as-substituent name, e.g. "cyclohexyl", "phenyl", "pyridin-2-yl".
 * attachAtomIdx: the ring atom where the bond to the chain is formed.
 * attachLocant: the IUPAC locant of that atom.
 */
export function ringSubstituentName(
  parentName: string,
  kind: "carbocycle" | "benzene" | "heterocycle",
  attachLocant: number,
): string {
  // benzene → phenyl (special)
  if (kind === "benzene") return "phenyl";

  // Carbocycles: cyclohexane → cyclohexyl (drop "-ane", add "-yl")
  //   The "-ane" suffix removal (not just trailing 'e') gives the correct stem:
  //   cyclohexane → cyclohex + yl = cyclohexyl (not cyclohexanyl).
  // Heterocycles: drop trailing 'e' only → pyridine → pyridin-2-yl.
  if (kind === "carbocycle") {
    const base = parentName.endsWith("ane") ? parentName.slice(0, -3) : parentName;
    if (attachLocant === 1) return `${base}yl`;
    return `${base}-${attachLocant}-yl`;
  }

  // Heterocycles: drop trailing 'e' → add '-locant-yl'
  const base = parentName.endsWith("e") ? parentName.slice(0, -1) : parentName;
  if (attachLocant === 1) return `${base}yl`;
  return `${base}-${attachLocant}-yl`;
}
