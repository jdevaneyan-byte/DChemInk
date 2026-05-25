// src/chem/naming/ring.ts
// Task 1: single-ring perception + canonical ring fingerprint (pure TS, no RDKit)
// Task 2: ring tables (carbocycle / benzene / heterocycle) + numbering
// Task T4S2: multi-ring perception (perceiveRingSystem) + polycyclic fingerprint + curated fused table
import type { MolGraph } from "./graph";

// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 0: Multi-ring system perception + classification
// ────────────────────────────────────────────────────────────────────────────────

export type RingSystemKind = "mono" | "fused" | "spiro" | "bridged" | "assembly" | "other";

export interface RingSystemInfo {
  /** Number of SSSR rings */
  ringCount: number;
  /** Classification of the overall ring system */
  kind: RingSystemKind;
  /** All ring atom indices (union of all SSSR rings) */
  atoms: Set<number>;
  /** All ring bond pairs (both directions; from < to) */
  bonds: Set<string>;
  /** Each SSSR ring as array of atom indices */
  rings: number[][];
}

/**
 * Perceive all SSSR rings from atom.ringIds and classify the ring system.
 *
 * Classification rules (for all rings considered together):
 *   mono     – exactly 1 ring
 *   fused    – 2+ rings, every pair of adjacent rings shares exactly 2 atoms AND
 *              those 2 atoms are joined by a bond (ortho-fused)
 *   spiro    – 2+ rings; at least one pair shares exactly 1 atom
 *   bridged  – 2+ rings; at least one pair shares exactly 2 atoms NOT bonded
 *   assembly – 2+ rings; no atoms shared between any rings (disjoint)
 *   other    – anything else (e.g. 3+ atoms shared, or peri-fused)
 */
export function perceiveRingSystem(graph: MolGraph): RingSystemInfo {
  // Collect SSSR rings from atom.ringIds
  const ringAtomLists = new Map<number, number[]>();
  for (const a of graph.atoms) {
    for (const rid of a.ringIds) {
      if (!ringAtomLists.has(rid)) ringAtomLists.set(rid, []);
      ringAtomLists.get(rid)!.push(a.index);
    }
  }

  const rings = [...ringAtomLists.values()];
  const ringCount = rings.length;

  // Build bond index for quick lookup
  const bondSet = new Set<string>();
  for (const b of graph.bonds) {
    const lo = Math.min(b.from, b.to);
    const hi = Math.max(b.from, b.to);
    bondSet.add(`${lo},${hi}`);
  }
  const hasBond = (a: number, b: number): boolean => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return bondSet.has(`${lo},${hi}`);
  };

  // Union of all ring atoms
  const allAtoms = new Set<number>();
  for (const r of rings) for (const a of r) allAtoms.add(a);

  // Build ring bond set (for adjacency queries)
  const allRingBonds = new Set<string>();
  for (const a of allAtoms) {
    for (const b of graph.bonds) {
      if ((b.from === a || b.to === a) && allAtoms.has(b.from) && allAtoms.has(b.to)) {
        const lo = Math.min(b.from, b.to);
        const hi = Math.max(b.from, b.to);
        allRingBonds.add(`${lo},${hi}`);
      }
    }
  }

  if (ringCount === 0) {
    return { ringCount: 0, kind: "mono", atoms: new Set(), bonds: new Set(), rings: [] };
  }
  if (ringCount === 1) {
    return { ringCount: 1, kind: "mono", atoms: allAtoms, bonds: allRingBonds, rings };
  }

  // For 2+ rings: examine all pairs
  // Build atom sets for each ring
  const ringSets = rings.map(r => new Set(r));

  let hasSpiro = false;
  let hasBridged = false;
  let hasOther = false;

  // Ring adjacency: ring i and ring j are "adjacent" if they share any atoms.
  // Used to determine if the ring system is connected (not a disjoint assembly).
  const ringNeighbors: Set<number>[] = rings.map(() => new Set<number>());

  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const shared: number[] = [];
      for (const a of ringSets[i]) {
        if (ringSets[j].has(a)) shared.push(a);
      }
      if (shared.length === 0) {
        // Disjoint pair: not adjacent in ring graph; check later if whole system is disconnected
      } else if (shared.length === 1) {
        hasSpiro = true;
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else if (shared.length === 2) {
        // Two shared atoms: ortho-fused if bonded, bridged otherwise
        if (!hasBond(shared[0], shared[1])) {
          hasBridged = true;
        }
        // (ortho-fused case: no flag needed — kind defaults to "fused" when no other flags set)
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else if (shared.length === 3) {
        // 3 shared atoms in SSSR rings: this is a bicyclo bridged system
        // e.g. norbornane: two SSSR rings sharing a one-atom bridge + two bridgeheads
        hasBridged = true;
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      } else {
        // 4+ shared atoms: could be a complex bridged system (e.g. bicyclo[2.2.2]octane
        // whose 3 SSSR rings each share 4 atoms with each other) or truly complex topology.
        // Flag as "mayBeBridged4" for secondary analysis; mark ringNeighbors as connected.
        hasBridged = true;  // tentatively; secondary check below validates
        ringNeighbors[i].add(j);
        ringNeighbors[j].add(i);
      }
    }
  }

  // Check if the ring system is connected (all rings reachable from ring 0)
  const ringVisited = new Set<number>([0]);
  const ringQueue = [0];
  while (ringQueue.length > 0) {
    const cur = ringQueue.shift()!;
    for (const nb of ringNeighbors[cur]) {
      if (!ringVisited.has(nb)) {
        ringVisited.add(nb);
        ringQueue.push(nb);
      }
    }
  }
  const isDisconnectedAssembly = ringVisited.size < rings.length;

  // Secondary bridgehead check: when hasBridged was set (possibly from a 4+ shared atoms pair),
  // validate by counting ring atoms with internal degree ≥ 3 (the bridgeheads).
  // Valid bridged systems:
  //   2 bridgeheads → standard bicyclo (bicyclo[a.b.c], e.g. norbornane, bicyclo[2.2.2]octane)
  //   4 bridgeheads → polycyclic bridged (tricyclo, e.g. adamantane)
  //   other → truly complex topology → "other"
  if (hasBridged && !hasSpiro) {
    // Count ring-internal degree for all atoms
    const ringDeg = new Map<number, number>();
    for (const a of allAtoms) ringDeg.set(a, 0);
    for (const b of graph.bonds) {
      if (allAtoms.has(b.from) && allAtoms.has(b.to)) {
        ringDeg.set(b.from, (ringDeg.get(b.from) ?? 0) + 1);
        ringDeg.set(b.to, (ringDeg.get(b.to) ?? 0) + 1);
      }
    }
    const bridgeheadCount = [...ringDeg.values()].filter(d => d >= 3).length;
    if (bridgeheadCount !== 2 && bridgeheadCount !== 4) {
      // Truly complex polycyclic (can't be confidently handled as bridged)
      hasOther = true;
    }
  }

  let kind: RingSystemKind;
  if (hasOther) {
    kind = "other";
  } else if (hasSpiro) {
    kind = "spiro";
  } else if (hasBridged) {
    kind = "bridged";
  } else if (isDisconnectedAssembly) {
    // The rings form disconnected components (e.g. biphenyl: two separate benzene rings)
    kind = "assembly";
  } else {
    // All rings are connected via shared atoms/bonds → fused (ortho-fused for our purposes)
    kind = "fused";
  }

  return { ringCount, kind, atoms: allAtoms, bonds: allRingBonds, rings };
}

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
  // ── Saturated 5-membered (two N) — RETAINED names (HW would give diazolidine) ──
  {
    // imidazolidine = 1,3-diaza saturated 5-ring (N-C-N-C-C)
    name: "imidazolidine",
    size: 5,
    aromatic: false,
    elementSeqs: [["N", "C", "N", "C", "C"]],
  },
  {
    // pyrazolidine = 1,2-diaza saturated 5-ring (N-N-C-C-C)
    name: "pyrazolidine",
    size: 5,
    aromatic: false,
    elementSeqs: [["N", "N", "C", "C", "C"]],
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
  // ── Saturated 6-membered (S + N at 1,4) = thiomorpholine (RETAINED; HW → 1,4-thiazinane) ──
  {
    name: "thiomorpholine",
    size: 6,
    aromatic: false,
    elementSeqs: [["S", "C", "C", "N", "C", "C"]],
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

  // All non-aromatic HETERO_TABLE entries are SATURATED parents (oxane, oxolane,
  // piperidine, …). A non-aromatic ring that still carries a ring double bond
  // (e.g. 2H-pyran, 2,3-dihydrofuran) is NOT one of them — it must not match and
  // then have its unsaturation mis-expressed as "oxa-2,4-diene". Such partially
  // unsaturated heterocycles are handled by the Hantzsch–Widman generator.
  const ringSet = new Set(ring.atoms);
  const ringHasDoubleBond = graph.bonds.some(
    (b) => b.order === 2 && ringSet.has(b.from) && ringSet.has(b.to),
  );

  for (const entry of HETERO_TABLE) {
    if (entry.size !== n || entry.aromatic !== ring.aromatic) continue;
    if (!entry.aromatic && ringHasDoubleBond) continue; // saturated entry vs unsaturated ring

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

// ── Hantzsch–Widman generator (saturated monocyclic heterocycles) ──────────────
// Replacement prefixes in seniority order O > S > N (we support these three;
// rings with other heteroatoms decline). Saturated stems by ring size, varying
// on the presence of nitrogen. The 'a' of a replacement prefix elides before a
// following vowel (another prefix or the stem — all saturated stems are
// vowel-initial). Lowest locants go to the heteroatoms as a set, then to the
// most senior heteroatom.
const HW_PREFIX: Record<string, string> = { O: "oxa", S: "thia", N: "aza" };
const HW_SENIORITY: Record<string, number> = { O: 1, S: 2, N: 3 };
const HW_MULT = ["", "", "di", "tri", "tetra", "penta", "hexa"];

function hwStem(size: number, hasN: boolean): string | null {
  switch (size) {
    case 3: return hasN ? "iridine" : "irane";
    case 4: return hasN ? "etidine" : "etane";
    case 5: return hasN ? "olidine" : "olane";
    case 6: return hasN ? "inane" : "ane";
    case 7: return "epane";
    case 8: return "ocane";
    case 9: return "onane";
    case 10: return "ecane";
    default: return null;
  }
}

/** Concatenate, eliding a trailing 'a' before a vowel-initial continuation. */
function hwJoin(prefix: string, next: string): string {
  if (prefix.endsWith("a") && /^[aeiouy]/.test(next)) return prefix.slice(0, -1) + next;
  return prefix + next;
}

/**
 * Name a SATURATED monocyclic heterocycle via Hantzsch–Widman, returning the
 * parent name and locant map, or null when not expressible (unsaturated ring,
 * unsupported heteroatom, size out of range).
 */
export function nameHantzschWidman(ring: RingInfo, graph: MolGraph): RingNaming | null {
  const n = ring.size;
  if (n < 3 || n > 10) return null;

  const atomById = new Map(graph.atoms.map((a) => [a.index, a]));
  const ringSet = new Set(ring.atoms);

  // Saturated only: no ring double bonds.
  const ringDoubleBond = graph.bonds.some(
    (b) => b.order === 2 && ringSet.has(b.from) && ringSet.has(b.to),
  );
  if (ringDoubleBond) return null;

  // All heteroatoms must be HW-expressible (O/S/N).
  for (const idx of ring.heteroatoms) {
    const el = atomById.get(idx)?.element ?? "C";
    if (!(el in HW_PREFIX)) return null;
  }

  const elementAt = (idx: number) => atomById.get(idx)?.element ?? "C";
  const hasN = ring.heteroatoms.some((idx) => elementAt(idx) === "N");

  const stem = hwStem(n, hasN);
  if (!stem) return null;

  // ── Choose the numbering: lowest locants to heteroatoms (as a set), then to
  // the most senior heteroatom. Enumerate every start position and direction. ──
  const heteroSet = new Set(ring.heteroatoms);
  let best: { locantOf: Map<number, number>; key: number[] } | null = null;
  for (let start = 0; start < n; start++) {
    for (const fwd of [true, false]) {
      const locantOf = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const pos = fwd ? (start + i) % n : ((start - i) % n + n) % n;
        locantOf.set(ring.atoms[pos], i + 1);
      }
      // Sort key: heteroatom locants ascending, then per-heteroatom (locant,
      // seniority) so a tie on the set prefers the senior element at the lower locant.
      const hetLocs = ring.atoms
        .filter((idx) => heteroSet.has(idx))
        .map((idx) => ({ loc: locantOf.get(idx)!, sen: HW_SENIORITY[elementAt(idx)] }))
        .sort((a, b) => a.loc - b.loc);
      const key: number[] = [];
      for (const h of hetLocs) key.push(h.loc);
      for (const h of hetLocs) key.push(h.sen);
      if (!best || compareLocantSets(key, best.key) < 0) best = { locantOf, key };
    }
  }
  if (!best) return null;
  const locantOf = best.locantOf;

  // ── Build the replacement prefix in seniority order with multipliers ──────────
  const byElement = new Map<string, number[]>(); // element → sorted locants
  for (const idx of ring.heteroatoms) {
    const el = elementAt(idx);
    const arr = byElement.get(el) ?? [];
    arr.push(locantOf.get(idx)!);
    byElement.set(el, arr);
  }
  const elementsInOrder = [...byElement.keys()].sort((a, b) => HW_SENIORITY[a] - HW_SENIORITY[b]);

  let prefix = "";
  const allLocants: number[] = [];
  for (const el of elementsInOrder) {
    const locs = byElement.get(el)!.sort((a, b) => a - b);
    allLocants.push(...locs);
    const token = `${HW_MULT[locs.length] ?? ""}${HW_PREFIX[el]}`;
    prefix = prefix === "" ? token : hwJoin(prefix, token);
  }
  const parent = hwJoin(prefix, stem);

  // Cite locants only when there is more than one heteroatom (a lone heteroatom
  // is always at locant 1, which is omitted: "oxane", "oxocane").
  allLocants.sort((a, b) => a - b);
  const name = allLocants.length > 1 ? `${allLocants.join(",")}-${parent}` : parent;

  return { parent: name, locantOf, kind: "heterocycle" };
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
    if (!match) {
      // Fall back to the algorithmic Hantzsch–Widman generator for SATURATED
      // monocyclic heterocycles not in the curated retained table (1,3-dioxolane,
      // 1,4-dioxane, 1,3-oxazinane, oxocane, …). Unsaturated non-aromatic
      // heterocycles (indicated-H systems like 2H-pyran) remain declined.
      const hw = nameHantzschWidman(ring, graph);
      if (hw) return hw;
      return null; // not in table / not HW-expressible → Tier 4
    }

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
// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 2: polycyclic fingerprint + curated fused table + isomorphism naming
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Atom label for polycyclic fingerprint: element + (for H-bearing heteroatoms) H count.
 * Aromatic ring atoms are detected by examining the ring-bond network.
 */
function fusedAtomLabel(graph: MolGraph, idx: number): string {
  const a = graph.atoms.find(x => x.index === idx);
  if (!a) return "?";
  // H on heteroatom is significant (e.g. N-H vs pyridine-N vs pyrrole-N)
  if (a.element !== "C" && a.hydrogens > 0) {
    return `${a.element}H${a.hydrogens}`;
  }
  return a.element;
}

/**
 * Bond label between two ring atoms (use order, but normalize aromatic ring bonds).
 * Since all fused systems we care about are aromatic, use "ar" for all ring bonds
 * between aromatic-ring atoms and actual order otherwise.
 */
function fusedBondLabel(graph: MolGraph, a: number, b: number): string {
  for (const bond of graph.bonds) {
    if ((bond.from === a && bond.to === b) || (bond.from === b && bond.to === a)) {
      // Use actual Kekulé order; this is stable for aromatic systems
      return String(bond.order);
    }
  }
  return "1";
}

/**
 * Build a canonical polycyclic fingerprint for the fused ring skeleton.
 *
 * Algorithm:
 * 1. Collect all ring atoms and ring bonds (bonds with both endpoints in ring).
 * 2. Build the local graph with atom labels and bond labels.
 * 3. Use WL (Weisfeiler-Lehman) iteration to get canonical atom signatures.
 * 4. Canonicalize by finding the starting atom that produces the lex-smallest
 *    BFS sequence.
 *
 * Returns a canonical string that is identical for all valid graph isomorphs.
 */
export function polycyclicFingerprint(graph: MolGraph, ringSys: RingSystemInfo): string {
  const atoms = [...ringSys.atoms].sort((a, b) => a - b);
  if (atoms.length === 0) return "";

  const atomLabel = (idx: number): string => fusedAtomLabel(graph, idx);
  const bondLabel = (a: number, b: number): string => fusedBondLabel(graph, a, b);

  // Build adjacency for ring atoms (ring bonds only)
  const adj = new Map<number, number[]>();
  for (const a of atoms) adj.set(a, []);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      adj.get(b.from)!.push(b.to);
      adj.get(b.to)!.push(b.from);
    }
  }

  // Produce canonical BFS string starting from each atom, pick lex-smallest
  // BFS format: atomLabel(bond_order)atomLabel(bond_order)...
  function bfsString(start: number): string {
    const visited = new Set<number>([start]);
    const queue: number[] = [start];
    const parts: string[] = [atomLabel(start)];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      // Sort neighbors by their BFS-canonical label for determinism
      const nbrs = (adj.get(cur) ?? []).filter(n => !visited.has(n));
      // Sort by: bond label, then atom label
      nbrs.sort((a, b) => {
        const bl1 = bondLabel(cur, a), bl2 = bondLabel(cur, b);
        if (bl1 !== bl2) return bl1 < bl2 ? -1 : 1;
        const al1 = atomLabel(a), al2 = atomLabel(b);
        return al1 < al2 ? -1 : al1 > al2 ? 1 : 0;
      });
      for (const nbr of nbrs) {
        visited.add(nbr);
        queue.push(nbr);
        parts.push(`(${bondLabel(cur, nbr)})${atomLabel(nbr)}`);
      }
    }
    return parts.join("|");
  }

  let best = "";
  for (const a of atoms) {
    const s = bfsString(a);
    if (best === "" || s < best) best = s;
  }
  return best;
}

// ── Curated fused ring table ──────────────────────────────────────────────────

export interface FusedRingEntry {
  /** IUPAC retained name (e.g. "naphthalene", "1H-indole") */
  name: string;
  /**
   * Canonical atom order: atoms listed in IUPAC locant order (index i → locant i+1).
   * Each element is an atom descriptor: `{ element, hydrogens }`
   * This describes the table's canonical form; isomorphism maps real atoms onto it.
   */
  canonicalOrder: { element: string; hydrogens: number }[];
  /**
   * Ring bonds in canonical order (for isomorphism matching).
   * Each entry is [locant_a - 1, locant_b - 1] (0-based indices into canonicalOrder).
   */
  canonicalBonds: [number, number][];
  /**
   * Indicated hydrogen locant (1-based), if any. E.g. 1 for "1H-indole", 7 for "7H-purine".
   * null for systems with no indicated H.
   */
  indicatedH: number | null;
}

/**
 * Build the ring graph adjacency for the table entry.
 * Returns adj: Map<index, Set<neighbor index>>.
 */
function tableAdj(entry: FusedRingEntry): Map<number, Set<number>> {
  const n = entry.canonicalOrder.length;
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) adj.set(i, new Set());
  for (const [a, b] of entry.canonicalBonds) {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return adj;
}

/**
 * The curated fused ring table.
 *
 * For each entry:
 * - canonicalOrder: atoms in IUPAC locant order (locant = index+1)
 * - canonicalBonds: bonds (pairs of 0-based indices)
 * - indicatedH: locant of N-H (1-based), or null
 *
 * Atom descriptors: { element, hydrogens } where hydrogens = attached H count.
 * For fully aromatic systems all H=0 except N-H positions.
 *
 * IUPAC numbering references: Nomenclature of Fused Polycyclic Hydrocarbons (IUPAC 2013),
 * Hantzsch-Widman names, and PubChem verified names.
 */
function C(hydrogens = 1): { element: string; hydrogens: number } {
  return { element: "C", hydrogens };
}
function N(hydrogens = 0): { element: string; hydrogens: number } {
  return { element: "N", hydrogens };
}
function O(): { element: string; hydrogens: number } {
  return { element: "O", hydrogens: 0 };
}
function S(): { element: string; hydrogens: number } {
  return { element: "S", hydrogens: 0 };
}
const C0 = C(0); // fusion carbon (no H)

export const FUSED_RING_TABLE: FusedRingEntry[] = [
  // ────────────────────────────────────────────────────────────────────────────
  // NAPHTHALENE (C10H8): two fused benzene rings
  //
  // IUPAC locants: 1,2,3,4,(4a),5,6,7,8,(8a) – fusion atoms 4a and 8a are not
  // integers in IUPAC but we track them as indices 8,9 (never substituted).
  // Non-fusion atoms (locants 1–8) are at indices 0–7.
  //
  // Atom layout (0-based index = IUPAC locant - 1 for non-fusion):
  //   Ring 1: C(1)-C(2)-C(3)-C(4)-C4a-C8a  (indices 0,1,2,3,8,9)
  //   Ring 2: C4a-C(5)-C(6)-C(7)-C(8)-C8a  (indices 8,4,5,6,7,9)
  //   Fusion bond: C4a(8)–C8a(9)
  //
  // PubChem verified: 1-methylnaphthalene (CID 1321), 2-methylnaphthalene (CID 7314)
  {
    name: "naphthalene",
    indicatedH: null,
    canonicalOrder: [C(), C(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: 1-2-3-4-4a-8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: 4a-5-6-7-8-8a (fusion [8,9] already in ring1)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINOLINE (C9H7N): benzo[b]pyridine – N at position 1
  //
  // IUPAC: N(1),C(2),C(3),C(4),(C4a),C(5),C(6),C(7),C(8),(C8a)
  // Non-fusion atoms (1–8) at indices 0–7; fusion C4a=index 8, C8a=index 9.
  // Ring 1 (pyridine ring): N(0)-C(1)-C(2)-C(3)-C4a(8)-C8a(9)
  // Ring 2 (benzene ring): C4a(8)-C(4)-C(5)-C(6)-C(7)-C8a(9)
  //
  // PubChem verified: 2-methylquinoline (CID 7278) through 8-methylquinoline (CID 10324)
  {
    name: "quinoline",
    indicatedH: null,
    canonicalOrder: [N(), C(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: N1-C2-C3-C4-C4a-C8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: C4a-C5-C6-C7-C8-C8a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ISOQUINOLINE (C9H7N): N at position 2
  //
  // IUPAC: C(1),N(2),C(3),C(4),(C4a),C(5),C(6),C(7),C(8),(C8a)
  // Ring 1: C(0)-N(1)-C(2)-C(3)-C4a(8)-C8a(9)
  //
  // PubChem verified: 1-methylisoquinoline (CID 69472), 3-methyl (CID 69618), etc.
  {
    name: "isoquinoline",
    indicatedH: null,
    canonicalOrder: [C(), N(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: C1-N2-C3-C4-C4a-C8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: C4a-C5-C6-C7-C8-C8a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1-BENZOFURAN: benzo[b]furan – O at position 1 (5-membered heteroatom ring)
  //
  // IUPAC: O(1),C(2),C(3),(C3a),C(4),C(5),C(6),C(7),(C7a)
  // Non-fusion atoms (1–7) at indices 0–6; fusion C3a=index 7, C7a=index 8.
  // Ring 1 (furan, 5-membered): O(0)-C(1)-C(2)-C3a(7)-C7a(8)
  // Ring 2 (benzene, 6-membered): C3a(7)-C(3)-C(4)-C(5)-C(6)-C7a(8)
  //
  // PubChem verified: 2-methyl-1-benzofuran (CID 11725), 4-methyl through 7-methyl
  {
    name: "1-benzofuran",
    indicatedH: null,
    canonicalOrder: [O(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7    3a   7a
    canonicalBonds: [
      [0,1],[1,2],[2,7],[7,8],[8,0],        // Ring 1: O1-C2-C3-C3a-C7a
      [7,3],[3,4],[4,5],[5,6],[6,8],         // Ring 2: C3a-C4-C5-C6-C7-C7a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1-BENZOTHIOPHENE: benzo[b]thiophene – S at position 1
  //
  // Same topology as 1-benzofuran, S instead of O.
  // PubChem verified: 2-methyl through 7-methyl positions
  {
    name: "1-benzothiophene",
    indicatedH: null,
    canonicalOrder: [S(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7    3a   7a
    canonicalBonds: [
      [0,1],[1,2],[2,7],[7,8],[8,0],        // Ring 1: S1-C2-C3-C3a-C7a
      [7,3],[3,4],[4,5],[5,6],[6,8],         // Ring 2: C3a-C4-C5-C6-C7-C7a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-INDOLE: benzo[b]pyrrole – N-H at position 1
  //
  // IUPAC: NH(1),C(2),C(3),(C3a),C(4),C(5),C(6),C(7),(C7a)
  // Ring 1 (pyrrole, 5-membered): NH(0)-C(1)-C(2)-C3a(7)-C7a(8)
  // Ring 2 (benzene, 6-membered): C3a(7)-C(3)-C(4)-C(5)-C(6)-C7a(8)
  //
  // PubChem verified: 1-methylindole (CID 2722; note: 1-methyl by N-methylation),
  //   2-methyl-1H-indole (CID 11120), 3-methyl through 7-methyl
  {
    name: "1H-indole",
    indicatedH: 1,
    canonicalOrder: [N(1), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1      2     3     4     5     6     7    3a   7a
    canonicalBonds: [
      [0,1],[1,2],[2,7],[7,8],[8,0],        // Ring 1: N1-C2-C3-C3a-C7a
      [7,3],[3,4],[4,5],[5,6],[6,8],         // Ring 2: C3a-C4-C5-C6-C7-C7a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-BENZIMIDAZOLE: benzo[d]imidazole – N-H at position 1, N at position 3
  //
  // IUPAC: NH(1),C(2),N(3),(C3a),C(4),C(5),C(6),C(7),(C7a)
  // Ring 1 (imidazole, 5-membered): NH(0)-C(1)-N(2)-C3a(7)-C7a(8)
  // Ring 2 (benzene, 6-membered): C3a(7)-C(3)-C(4)-C(5)-C(6)-C7a(8)
  //
  // PubChem verified: 2-methyl-1H-benzimidazole (CID 10189), 5-methyl, 6-methyl
  // Note: due to the N1-H/N3 symmetry, 4-methyl and 7-methyl are equivalent,
  //   and 5-methyl and 6-methyl are equivalent in the unsubstituted parent.
  {
    name: "1H-benzimidazole",
    indicatedH: 1,
    canonicalOrder: [N(1), C(), N(), C(), C(), C(), C(), C0, C0],
    //                 1      2     3     4     5     6     7    3a   7a
    canonicalBonds: [
      [0,1],[1,2],[2,7],[7,8],[8,0],        // Ring 1: NH1-C2-N3-C3a-C7a
      [7,3],[3,4],[4,5],[5,6],[6,8],         // Ring 2: C3a-C4-C5-C6-C7-C7a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 1H-INDAZOLE: benzo[c]pyrazole – N-H at position 1, N at position 2
  //
  // IUPAC: NH(1),N(2),C(3),(C3a),C(4),C(5),C(6),C(7),(C7a)
  // Ring 1 (pyrazole, 5-membered): NH(0)-N(1)-C(2)-C3a(7)-C7a(8)
  // Ring 2 (benzene, 6-membered): C3a(7)-C(3)-C(4)-C(5)-C(6)-C7a(8)
  //
  // PubChem verified: 3-methyl-1H-indazole (CID 11738 is 5-methyl; CID 12155 is 3-methyl),
  //   5-methyl-1H-indazole, etc.
  {
    name: "1H-indazole",
    indicatedH: 1,
    canonicalOrder: [N(1), N(), C(), C(), C(), C(), C(), C0, C0],
    //                 1      2     3     4     5     6     7    3a   7a
    canonicalBonds: [
      [0,1],[1,2],[2,7],[7,8],[8,0],        // Ring 1: NH1-N2-C3-C3a-C7a
      [7,3],[3,4],[4,5],[5,6],[6,8],         // Ring 2: C3a-C4-C5-C6-C7-C7a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINOXALINE: benzo[g]pyrazine (1,4-benzodiazine) – N at 1 and 4
  //
  // IUPAC: N(1),C(2),C(3),N(4),(C4a),C(5),C(6),C(7),C(8),(C8a)
  // Ring 1 (pyrazine, 6-membered): N(0)-C(1)-C(2)-N(3)-C4a(8)-C8a(9)
  // Ring 2 (benzene, 6-membered): C4a(8)-C(4)-C(5)-C(6)-C(7)-C8a(9)
  //
  // PubChem verified: 2-methylquinoxaline (CID 11758), 5-methylquinoxaline,
  //   6-methylquinoxaline
  {
    name: "quinoxaline",
    indicatedH: null,
    canonicalOrder: [N(), C(), C(), N(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: N1-C2-C3-N4-C4a-C8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: C4a-C5-C6-C7-C8-C8a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // QUINAZOLINE: benzo[d]pyrimidine – N at 1 and 3
  //
  // IUPAC: N(1),C(2),N(3),C(4),(C4a),C(5),C(6),C(7),C(8),(C8a)
  // Ring 1 (pyrimidine, 6-membered): N(0)-C(1)-N(2)-C(3)-C4a(8)-C8a(9)
  // Ring 2 (benzene, 6-membered): C4a(8)-C(4)-C(5)-C(6)-C(7)-C8a(9)
  //
  // PubChem verified: 2-methylquinazoline, 4-methylquinazoline, 6-methylquinazoline
  {
    name: "quinazoline",
    indicatedH: null,
    canonicalOrder: [N(), C(), N(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: N1-C2-N3-C4-C4a-C8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: C4a-C5-C6-C7-C8-C8a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // CINNOLINE: benzo[c]pyridazine – N at 1 and 2 (adjacent)
  //
  // IUPAC: N(1),N(2),C(3),C(4),(C4a),C(5),C(6),C(7),C(8),(C8a)
  // Ring 1 (pyridazine, 6-membered): N(0)-N(1)-C(2)-C(3)-C4a(8)-C8a(9)
  // Ring 2 (benzene, 6-membered): C4a(8)-C(4)-C(5)-C(6)-C(7)-C8a(9)
  //
  // PubChem verified: 3-methylcinnoline (CID 2726380), 4-methyl, 5-methyl,
  //   6-methyl, 7-methyl, 8-methylcinnoline
  {
    name: "cinnoline",
    indicatedH: null,
    canonicalOrder: [N(), N(), C(), C(), C(), C(), C(), C(), C0, C0],
    //                 1     2     3     4     5     6     7     8    4a   8a
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,8],[8,9],[9,0],  // Ring 1: N1-N2-C3-C4-C4a-C8a
      [8,4],[4,5],[5,6],[6,7],[7,9],         // Ring 2: C4a-C5-C6-C7-C8-C8a
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7H-PURINE: imidazo[4,5-d]pyrimidine – N at 1,3,7,9 (bicyclic, 4N)
  //
  // Purine has no "a" locants — all 9 atoms have integer IUPAC locants 1–9
  // (C4 and C5 are the fusion atoms; index+1 IS the IUPAC locant).
  //
  // IUPAC numbering for 7H-purine:
  //   Ring I (pyrimidine, 6-membered): N1,C2,N3,C4(fused),C5(fused),C6
  //   Ring II (imidazole, 5-membered): C4,C5,N7(H),C8,N9  (shared: C4,C5)
  // 0-based: 0=N(1),1=C(2),2=N(3),3=C4(fused),4=C5(fused),5=C(6),6=N7(H),7=C(8),8=N(9)
  //
  // PubChem: 7H-purine (CID 1044); accepts both 7H and 9H tautomer SMILES.
  {
    name: "7H-purine",
    indicatedH: 7,
    canonicalOrder: [N(), C(), N(), C0, C0, C(), N(1), C(), N()],
    canonicalBonds: [
      [0,1],[1,2],[2,3],[3,4],[4,5],[5,0], // pyrimidine ring
      [3,8],[8,7],[7,6],[6,4],              // imidazole ring (shared: 3=C4, 4=C5)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7H-PURINE (9H-tautomer topology): same preferred name per PubChem normalization
  //
  // The SMILES c1nc2[nH]cnc2cn1 draws the 9H tautomer (NH at N9) but PubChem
  // normalizes this to "7H-purine". We accept both tautomer topologies.
  // 0-based drawn indices from c1nc2[nH]cnc2cn1:
  //   0=C, 1=N, 2=C(C4 fusion), 3=NH(N9), 4=C(N9-adjacent), 5=N, 6=C(C5 fusion), 7=C, 8=N
  {
    name: "7H-purine",
    indicatedH: 7,
    canonicalOrder: [C(), N(), C0, N(1), C(), N(), C0, C(), N()],
    canonicalBonds: [
      [0,1],[1,2],[2,6],[6,7],[7,8],[8,0], // pyrimidine ring (6-membered)
      [2,3],[3,4],[4,5],[5,6],              // imidazole ring (5-membered; shared: 2=C4, 6=C5)
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // ANTHRACENE (C14H10): three linearly fused benzene rings
  //
  // IUPAC locants: 1–10 (non-fusion) + 4a,4b,8a,9a (4 fusion atoms, indices 10–13).
  //
  //   Ring A (right terminal): C1(0)-C2(1)-C3(2)-C4(3)-C4a(10)-C9a(13)
  //   Ring B (left terminal):  C4b(11)-C5(4)-C6(5)-C7(6)-C8(7)-C8a(12)
  //   Ring C (middle):         C4a(10)-C9a(13)-C9(8)-C10(9)-C4b(11)-C8a(12)... wait
  //
  // The middle ring of anthracene: C4a-C4b-C8a-C9-C10-C9a (linear topology means
  // C4a is bonded to C4 and to C9a; C4b is bonded to C5 and to C8a; C9 and C10 are
  // the peri positions in the middle ring).
  //
  //   Middle ring bonds: C4a(10)-C9a(13), C9a(13)-C9(8), C9(8)-C10(9),
  //                      C10(9)-C4b(11), C4b(11)-C8a(12), C8a(12)-C4a(10)
  //
  // PubChem verified: 1-methylanthracene (CID 11316), 2-methylanthracene (CID 7726)
  {
    name: "anthracene",
    indicatedH: null,
    canonicalOrder: [
      C(), C(), C(), C(), C(), C(), C(), C(), C(), C(), C0,  C0,  C0,  C0,
    //  1     2     3     4     5     6     7     8     9    10   4a   4b   8a   9a
    ],
    canonicalBonds: [
      // Ring A: C1-C2-C3-C4-C4a-C9a
      [0,1],[1,2],[2,3],[3,10],[10,13],[13,0],
      // Ring B: C4b-C5-C6-C7-C8-C8a
      [11,4],[4,5],[5,6],[6,7],[7,12],[12,11],
      // Middle ring: C4a-C10-C4b-[ring B shared C4b-C8a]-C8a-C9-C9a-[ring A shared C9a-C4a]
      // Key: C10(9) is bonded to C4a(10) AND C4b(11); C9(8) is bonded to C8a(12) AND C9a(13)
      // There is NO direct C4a-C8a bond in anthracene (linear topology).
      [10,9],[9,11],[12,8],[8,13],
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  // PHENANTHRENE (C14H10): three angularly fused benzene rings
  //
  // IUPAC locants: 1–10 (non-fusion) + 4a,4b,8a,10a (4 fusion atoms, indices 10–13).
  // Angular fusion: Ring A and Ring B share C4a–C10a (one side); Ring B and Ring C
  // share C4b–C8a (other side). Ring B is the "middle" ring.
  //
  //   Ring A: C1(0)-C2(1)-C3(2)-C4(3)-C4a(10)-C10a(13)
  //   Ring C: C4b(11)-C5(4)-C6(5)-C7(6)-C8(7)-C8a(12)
  //   Ring B (middle): C4a(10)-C10a(13)-C10(9)-C9(8)-C8a(12)... wait
  //
  // Phenanthrene middle ring (6-membered): C4a-C4b-C8a-C9-C10-C10a
  //   Middle ring bonds: C4a(10)-C4b(11), C4b(11)-C8a(12)...
  // Hmm: Angular means Ring B (middle) connects Ring A via C4a–C10a and
  //   connects Ring C via C4b–C8a. The middle ring is: C4a-C10a-C10-C9-C8a-C4b.
  //   Wait — in phenanthrene, C10a is adjacent to C1(ring A) AND C10(middle ring).
  //   C4b is adjacent to C5(ring C) AND to C4a(middle)? That would make Ring B
  //   contain: C4a-C10a-C10-C9-C8a-C4b, connecting via bonds C4a–C10a and C4b–C8a.
  //   But that's NOT angular — that would be linear (anthracene-like) because
  //   both fusion bonds are on the SAME FACE of the middle ring.
  //
  // For ANGULAR fusion: Ring A bonds to Ring B via one bond (C4a–C4b? or C4a–C10a?),
  //   and Ring B bonds to Ring C via a bond on the ADJACENT side of Ring B.
  //   In phenanthrene, Ring A uses C4a–C10a, and Ring C uses C4b–C8a. These two
  //   shared bonds are at an ANGLE (not on opposite sides of ring B as in anthracene).
  //
  //   Phenanthrene middle ring: C4a-C4b-C8a-C9-C10-C10a
  //   Bonds: C4a(10)-C4b(11), C4b(11)-C8a(12), C8a(12)-C9(8), C9(8)-C10(9), C10(9)-C10a(13), C10a(13)-C4a(10)
  //
  //   vs Anthracene middle ring: C4a-C4b-C8a-C9-C10-C9a (C9a adj to C4a; C8a adj to C4b)
  //   Bonds: C4a(10)-C9a(13), C9a(13)-C9(8), C9(8)-C10(9), C10(9)-C4b(11), C4b(11)-C8a(12), C8a(12)-C4a(10)
  //
  // So the DIFFERENCE is: anthracene has C4a bonded to C9a (ring A partner) AND C8a;
  //   phenanthrene has C4a bonded to C10a (ring A partner) AND C4b.
  //
  // PubChem verified: 1-methylphenanthrene, 2-methyl (CID 2723), 3-methyl, 4-methyl,
  //   9-methylphenanthrene (CID 11742 is 9-methylanthracene; phenanthrene 9-methyl is CID 10367)
  {
    name: "phenanthrene",
    indicatedH: null,
    canonicalOrder: [
      C(), C(), C(), C(), C(), C(), C(), C(), C(), C(), C0,  C0,  C0,  C0,
    //  1     2     3     4     5     6     7     8     9    10   4a   4b   8a  10a
    ],
    canonicalBonds: [
      // Ring A: C1-C2-C3-C4-C4a-C10a
      [0,1],[1,2],[2,3],[3,10],[10,13],[13,0],
      // Ring C: C4b-C5-C6-C7-C8-C8a
      [11,4],[4,5],[5,6],[6,7],[7,12],[12,11],
      // Middle ring (B): C4a-C4b-C8a-C9-C10-C10a (angular: C4a bonds C4b, not C9a)
      [10,11],[12,8],[8,9],[9,13],
      // (Bonds [10,13] and [11,12] are the ring A/C fusion bonds, already listed above)
    ],
  },
];

// ── Graph isomorphism for fused ring systems ──────────────────────────────────

/**
 * Find all graph isomorphisms between the drawn ring system and the table entry.
 * Returns a list of maps: drawn atom index → table locant (1-based).
 *
 * Uses VF2-style backtracking for small graphs (≤14 atoms).
 *
 * @param graph - the full molecular graph
 * @param ringSys - the perceived ring system
 * @param entry - the table entry to match against
 */
function findIsomorphisms(
  graph: MolGraph,
  ringSys: RingSystemInfo,
  entry: FusedRingEntry,
): Map<number, number>[] {
  const drawnAtoms = [...ringSys.atoms].sort((a, b) => a - b);
  const tableAtoms = entry.canonicalOrder;
  const n = tableAtoms.length;

  if (drawnAtoms.length !== n) return [];

  // Build drawn adjacency (ring bonds only)
  const drawnAdj = new Map<number, Set<number>>();
  for (const a of drawnAtoms) drawnAdj.set(a, new Set());
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      drawnAdj.get(b.from)!.add(b.to);
      drawnAdj.get(b.to)!.add(b.from);
    }
  }

  // Build table adjacency (0-based), returns Map<index, Set<neighbor>>
  const tableAdjMap: Map<number, Set<number>> = tableAdj(entry);

  // Get drawn atom label (element + H count)
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  // Build full-graph degree (including non-ring bonds) for external-substituent detection
  const fullDegreeMap = new Map<number, number>();
  for (const b of graph.bonds) {
    fullDegreeMap.set(b.from, (fullDegreeMap.get(b.from) ?? 0) + 1);
    fullDegreeMap.set(b.to, (fullDegreeMap.get(b.to) ?? 0) + 1);
  }
  const drawnLabel = (idx: number): string => {
    const a = atomById.get(idx);
    if (!a) return "?";
    if (a.element !== "C" && a.hydrogens > 0) return `${a.element}H${a.hydrogens}`;
    // N with H=0 but external substituents (e.g. N-methyl): matches as "NH1"
    // to allow substitution at indicated-H positions (e.g. 1-methylindole at N1).
    if (a.element === "N" && a.hydrogens === 0) {
      const ringDeg = drawnAdj.get(idx)?.size ?? 0;
      const fullDeg = fullDegreeMap.get(idx) ?? 0;
      if (fullDeg > ringDeg) return "NH1"; // has external substituent → may occupy NH position
    }
    return a.element;
  };

  // Get table atom label
  const tableLabel = (i: number): string => {
    const t = tableAtoms[i];
    if (t.element !== "C" && t.hydrogens > 0) return `${t.element}H${t.hydrogens}`;
    return t.element;
  };

  // Check degree compatibility
  const drawnDegree = (idx: number): number => drawnAdj.get(idx)?.size ?? 0;
  const tableDegree = (i: number): number => tableAdjMap.get(i)?.size ?? 0;

  // VF2-style backtracking
  const mapping: Map<number, number> = new Map(); // drawnAtom → tableIndex (0-based)
  const usedTable = new Set<number>();
  const results: Map<number, number>[] = [];

  function isCompatible(drawnIdx: number, tableIdx: number): boolean {
    if (drawnLabel(drawnIdx) !== tableLabel(tableIdx)) return false;
    if (drawnDegree(drawnIdx) !== tableDegree(tableIdx)) return false;
    // Check consistency with existing partial mapping
    for (const [da, ta] of mapping) {
      const drawnConnected = drawnAdj.get(drawnIdx)?.has(da) ?? false;
      const tableConnected = tableAdjMap.get(tableIdx)?.has(ta) ?? false;
      if (drawnConnected !== tableConnected) return false;
    }
    return true;
  }

  function backtrack(step: number): void {
    if (step === n) {
      // Complete mapping found: convert to locant map (locant = tableIdx + 1)
      const locantMap = new Map<number, number>();
      for (const [da, ti] of mapping) {
        locantMap.set(da, ti + 1);
      }
      results.push(locantMap);
      return;
    }

    // Pick next drawn atom to map (in order of drawnAtoms array)
    const nextDrawn = drawnAtoms[step];

    // Try all unused table positions
    for (let ti = 0; ti < n; ti++) {
      if (usedTable.has(ti)) continue;
      if (!isCompatible(nextDrawn, ti)) continue;

      mapping.set(nextDrawn, ti);
      usedTable.add(ti);
      backtrack(step + 1);
      mapping.delete(nextDrawn);
      usedTable.delete(ti);
    }
  }

  backtrack(0);
  return results;
}

/**
 * Compare two locant arrays (ascending) for the isomorphism selection criterion.
 * Lower first-difference wins (IUPAC lowest locant rule).
 */
function compareLocantSets(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Result of fused ring name lookup.
 */
export interface FusedRingNaming {
  parent: string;
  /** Map: drawn atom index → IUPAC locant (1-based) */
  locantOf: Map<number, number>;
  /** Whether the name has an indicated hydrogen prefix (e.g. "1H-") */
  indicatedH: number | null;
  kind: "fused";
}

/**
 * Look up the fused ring system in the curated table, perform isomorphism
 * to assign locants, and return the naming or null if not matched.
 *
 * Selection among multiple isomorphisms:
 * 1. Lowest locant set for PCG atoms (if any)
 * 2. Lowest locant set for substituent atoms
 * 3. Arbitrary (first found)
 */
export function nameFusedRing(
  graph: MolGraph,
  ringSys: RingSystemInfo,
  opts: {
    pcgAtoms?: Set<number>;
    subAtoms?: Set<number>;
  } = {},
): FusedRingNaming | null {
  const n = ringSys.atoms.size;

  // Find matching table entries by atom count
  const candidates = FUSED_RING_TABLE.filter(e => e.canonicalOrder.length === n);
  if (candidates.length === 0) return null;

  for (const entry of candidates) {
    const isos = findIsomorphisms(graph, ringSys, entry);
    if (isos.length === 0) continue;

    // Among valid isomorphisms, pick the one with lowest locants for PCG, then subs
    let best = isos[0];

    if (opts.pcgAtoms && opts.pcgAtoms.size > 0) {
      let bestPcgLocs = [...opts.pcgAtoms]
        .map(a => best.get(a) ?? 99)
        .sort((x, y) => x - y);

      for (const iso of isos.slice(1)) {
        const pcgLocs = [...opts.pcgAtoms]
          .map(a => iso.get(a) ?? 99)
          .sort((x, y) => x - y);
        if (compareLocantSets(pcgLocs, bestPcgLocs) < 0) {
          best = iso;
          bestPcgLocs = pcgLocs;
        }
      }
    } else if (opts.subAtoms && opts.subAtoms.size > 0) {
      let bestSubLocs = [...opts.subAtoms]
        .map(a => best.get(a) ?? 99)
        .sort((x, y) => x - y);

      for (const iso of isos.slice(1)) {
        const subLocs = [...opts.subAtoms]
          .map(a => iso.get(a) ?? 99)
          .sort((x, y) => x - y);
        if (compareLocantSets(subLocs, bestSubLocs) < 0) {
          best = iso;
          bestSubLocs = subLocs;
        }
      }
    }

    return {
      parent: entry.name,
      locantOf: best,
      indicatedH: entry.indicatedH,
      kind: "fused",
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 3: von Baeyer (bridged) ring system naming
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Result of von Baeyer bridge detection.
 *
 * bridgeheads: [bh1, bh2] — the two bridgehead atom indices
 * bridges: paths between the bridgeheads, sorted longest-first.
 *          Each bridge is the sequence of INTERIOR atoms (excluding the bridgeheads).
 *          bridge[0] is the longest (size a), bridge[1] is second (size b), bridge[2] shortest (c).
 */
export interface BridgedBicyclicInfo {
  bridgeheads: [number, number];
  bridges: number[][];   // 3 bridges, sorted by length descending; interior atoms only
  ringAtoms: Set<number>;
}

/**
 * Find the two bridgehead atoms in a bicyclic ring system.
 *
 * Bridgeheads are ring atoms with degree ≥ 3 within the ring bond graph.
 * In a bicyclo[a.b.c] system there are exactly 2 bridgeheads.
 *
 * Returns null if the ring system is not a simple bicyclic (exactly 2 bridgeheads).
 */
function findBridgeheads(ringSys: RingSystemInfo, graph: MolGraph): [number, number] | null {
  // Build ring-internal degree (count only ring-to-ring bonds)
  const ringDeg = new Map<number, number>();
  for (const a of ringSys.atoms) ringDeg.set(a, 0);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      ringDeg.set(b.from, (ringDeg.get(b.from) ?? 0) + 1);
      ringDeg.set(b.to, (ringDeg.get(b.to) ?? 0) + 1);
    }
  }

  const bh: number[] = [];
  for (const [atom, deg] of ringDeg) {
    if (deg >= 3) bh.push(atom);
  }

  if (bh.length !== 2) return null;
  return [bh[0], bh[1]];
}

/**
 * Find all simple paths between bh1 and bh2 that stay within the ring atom set.
 * Returns the interior atoms (excluding the bridgeheads) for each bridge path.
 *
 * We use DFS; there are exactly 3 in a standard bicyclic system.
 * Returns null if not exactly 3 bridges found (bad topology).
 */
function findBridges(
  bh1: number,
  bh2: number,
  ringSys: RingSystemInfo,
  graph: MolGraph,
): number[][] | null {
  // Build adjacency restricted to ring atoms
  const adj = new Map<number, number[]>();
  for (const a of ringSys.atoms) adj.set(a, []);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      adj.get(b.from)!.push(b.to);
      adj.get(b.to)!.push(b.from);
    }
  }

  const bridges: number[][] = [];

  // DFS from bh1 to bh2, collecting interior atoms (not bh1 or bh2)
  function dfs(path: number[], visited: Set<number>): void {
    const cur = path[path.length - 1];
    for (const nbr of adj.get(cur) ?? []) {
      if (nbr === bh2) {
        // Found a bridge: interior is path[1..] (excluding bh1)
        bridges.push(path.slice(1));
        continue;
      }
      if (visited.has(nbr) || nbr === bh1) continue;
      visited.add(nbr);
      path.push(nbr);
      dfs(path, visited);
      path.pop();
      visited.delete(nbr);
    }
  }

  dfs([bh1], new Set([bh1]));

  if (bridges.length !== 3) return null;

  // Sort bridges longest-first (a ≥ b ≥ c)
  bridges.sort((x, y) => y.length - x.length);
  return bridges;
}

/**
 * Detect and return the full bicyclic bridge structure, or null if the ring
 * system cannot be identified as a simple bicyclo[a.b.c] skeleton.
 */
export function detectBridgedBicyclic(
  ringSys: RingSystemInfo,
  graph: MolGraph,
): BridgedBicyclicInfo | null {
  const bhs = findBridgeheads(ringSys, graph);
  if (!bhs) return null;

  const bridges = findBridges(bhs[0], bhs[1], ringSys, graph);
  if (!bridges) return null;

  // Verify all ring atoms are accounted for (2 bridgeheads + bridge interiors)
  const counted = new Set<number>(bhs);
  for (const br of bridges) for (const a of br) counted.add(a);
  if (counted.size !== ringSys.atoms.size) return null;

  return {
    bridgeheads: bhs,
    bridges,
    ringAtoms: ringSys.atoms,
  };
}

// ── Curated tricyclics (adamantane) ──────────────────────────────────────────

/**
 * Build a canonical connectivity fingerprint for a ring system.
 * Used to identify adamantane by its skeleton.
 * Format: sorted-degree sequence joined with "-".
 */
function skeletonFingerprint(ringSys: RingSystemInfo, graph: MolGraph): string {
  const deg = new Map<number, number>();
  for (const a of ringSys.atoms) deg.set(a, 0);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      deg.set(b.from, (deg.get(b.from) ?? 0) + 1);
      deg.set(b.to, (deg.get(b.to) ?? 0) + 1);
    }
  }
  // Also count element labels
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  const nodeTokens: string[] = [];
  for (const a of ringSys.atoms) {
    const el = atomById.get(a)?.element ?? "C";
    const d = deg.get(a) ?? 0;
    nodeTokens.push(`${el}${d}`);
  }
  nodeTokens.sort();
  return nodeTokens.join(",");
}

/**
 * Adamantane skeleton: 10 carbons; 4 bridgehead C3 + 6 bridge C2 = "C3,C3,C3,C3,C2,C2,C2,C2,C2,C2"
 * PubChem IUPAC name: "adamantane" (retained); SMILES: C1C2CC3CC1CC(C2)C3
 * systematic: tricyclo[3.3.1.1^{3,7}]decane (note superscript notation)
 */
const ADAMANTANE_FINGERPRINT = "C2,C2,C2,C2,C2,C2,C3,C3,C3,C3";

/**
 * Check if this ring system is adamantane (all-carbon, 10 atoms, correct degree sequence).
 */
export function isAdamantane(ringSys: RingSystemInfo, graph: MolGraph): boolean {
  if (ringSys.atoms.size !== 10) return false;
  // All ring atoms must be carbon
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  for (const a of ringSys.atoms) {
    if ((atomById.get(a)?.element ?? "") !== "C") return false;
  }
  const fp = skeletonFingerprint(ringSys, graph);
  return fp === ADAMANTANE_FINGERPRINT;
}

// ── Von Baeyer numbering ──────────────────────────────────────────────────────

/**
 * Alkane stem names for chain lengths used in von Baeyer nomenclature.
 * bicyclo[a.b.c]<stem>ane where stem = parent chain for (a+b+c+2) atoms.
 */
const VB_ALKANE_STEMS: Record<number, string> = {
  5:  "pentane",
  6:  "hexane",
  7:  "heptane",
  8:  "octane",
  9:  "nonane",
  10: "decane",
  11: "undecane",
  12: "dodecane",
};

/**
 * Heteroatom replacement prefix for von Baeyer nomenclature.
 * Priority order per IUPAC: O > S > N (Hantzsch-Widman/replacement 'a' nomenclature).
 */
const VB_HETERO_PREFIX: Record<string, string> = {
  O: "oxa",
  S: "thia",
  N: "aza",
};

/** Priority for heteroatom replacement (lower = higher priority for lowest locant). */
const VB_HETERO_PRIORITY: Record<string, number> = {
  O: 1, S: 2, N: 3,
};

export interface VonBaeyerNaming {
  /** Full IUPAC name (e.g. "bicyclo[2.2.1]heptane") */
  name: string;
  /** Map from ring atom index → IUPAC locant (1-based) */
  locantOf: Map<number, number>;
  /** Descriptor string, e.g. "2.2.1" */
  descriptor: string;
  /** Parent alkane stem, e.g. "bicyclo[2.2.1]heptane" */
  parent: string;
}

/**
 * Build the von Baeyer name for a bridged bicyclic ring system.
 *
 * Algorithm:
 * 1. Two bridgeheads bh1, bh2; bridges sorted a ≥ b ≥ c.
 * 2. Try both choices of start bridgehead × both directions of b (bridge[1])
 *    (c bridge traversal direction is fixed once bh1,bh2,a,b are fixed).
 * 3. For each candidate numbering, compute heteroatom locants → select lowest.
 * 4. Assemble name with heteroatom replacement prefixes.
 *
 * Returns null if:
 * - Total atoms not in VB_ALKANE_STEMS
 * - A heteroatom element is not in VB_HETERO_PREFIX
 * - The numbering produces no valid descriptor
 */
export function nameVonBaeyer(
  info: BridgedBicyclicInfo,
  graph: MolGraph,
  opts: {
    unsatBonds?: [number, number][];  // ring double bonds for ene suffix
    subAtoms?: Set<number>;           // ring atoms with substituents (for locant optimization)
    pcgAtoms?: Set<number>;           // ring atoms carrying PCG
  } = {},
): VonBaeyerNaming | null {
  const { bridgeheads, bridges } = info;
  const [bh1_orig, bh2_orig] = bridgeheads;
  const [bA, bB, bC] = bridges;  // a ≥ b ≥ c

  const totalAtoms = bA.length + bB.length + bC.length + 2;
  const descriptor = `${bA.length}.${bB.length}.${bC.length}`;

  const alkaneBase = VB_ALKANE_STEMS[totalAtoms];
  if (!alkaneBase) return null; // out of our range

  // Check all heteroatoms in ring can be expressed
  const atomById = new Map(graph.atoms.map(a => [a.index, a]));
  for (const a of info.ringAtoms) {
    const el = atomById.get(a)?.element ?? "C";
    if (el !== "C" && !(el in VB_HETERO_PREFIX)) return null;
  }

  // Build ring adjacency for direction checking
  const ringAdj2 = new Map<number, Set<number>>();
  for (const a of info.ringAtoms) ringAdj2.set(a, new Set());
  for (const b of graph.bonds) {
    if (info.ringAtoms.has(b.from) && info.ringAtoms.has(b.to)) {
      ringAdj2.get(b.from)!.add(b.to);
      ringAdj2.get(b.to)!.add(b.from);
    }
  }
  function adjacentInRing(a: number, b: number): boolean {
    return ringAdj2.get(a)?.has(b) ?? false;
  }

  /**
   * Evaluate a locant map: extract locants for heteroatoms, PCG, substituents.
   * Returns a tuple [heteroLocs, pcgLocs, subLocs, unsatLocs] for comparison.
   */
  function evalMap(m: Map<number, number>): {
    heteroLocs: number[];
    pcgLocs: number[];
    subLocs: number[];
    unsatLocs: number[];
  } {
    const heteroLocs: number[] = [];
    for (const a of info.ringAtoms) {
      const el = atomById.get(a)?.element ?? "C";
      if (el !== "C") {
        const loc = m.get(a);
        if (loc !== undefined) heteroLocs.push(loc);
      }
    }
    heteroLocs.sort((x, y) => x - y);

    const pcgLocs: number[] = [];
    if (opts.pcgAtoms) {
      for (const a of opts.pcgAtoms) {
        const loc = m.get(a);
        if (loc !== undefined) pcgLocs.push(loc);
      }
      pcgLocs.sort((x, y) => x - y);
    }

    const subLocs: number[] = [];
    if (opts.subAtoms) {
      for (const a of opts.subAtoms) {
        const loc = m.get(a);
        if (loc !== undefined) subLocs.push(loc);
      }
      subLocs.sort((x, y) => x - y);
    }

    const unsatLocs: number[] = [];
    if (opts.unsatBonds) {
      for (const [a, b] of opts.unsatBonds) {
        const la = m.get(a) ?? 99;
        const lb = m.get(b) ?? 99;
        unsatLocs.push(Math.min(la, lb));
      }
      unsatLocs.sort((x, y) => x - y);
    }

    return { heteroLocs, pcgLocs, subLocs, unsatLocs };
  }

  function compareLocArr(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
  }

  // Generate all candidate numberings:
  //   × 2 start bridgehead choices
  //   × all permutations of same-length bridges at positions A,B (or B,C if sizes equal)
  //
  // For [2.2.1]: bridges a=2,b=2,c=1 — need to try swapping A and B (same size).
  // For [2.2.2]: bridges a=2,b=2,c=2 — all 3 permutations of (A,B,C) matter.
  // For [2.2.1]: only a=b case relevant.
  //
  // We generate all orderings of the bridges where bridge sizes allow it (equal lengths).
  // Since c may differ from a,b, we only permute among equal-length bridges.

  function generateBridgeOrderings(): [number[], number[], number[]][] {
    // Returns list of [bA_candidate, bB_candidate, bC_candidate]
    const orderings: [number[], number[], number[]][] = [];

    // Collect all possible bridge orderings (a≥b≥c constraint → only swap equal ones)
    const allBridges = [bA, bB, bC];
    const sizes = allBridges.map(b => b.length);

    // Generate permutations of indices, keeping the sort order a≥b≥c
    const perms: number[][] = [];
    function permute(arr: number[], current: number[]): void {
      if (arr.length === 0) { perms.push([...current]); return; }
      for (let i = 0; i < arr.length; i++) {
        const rest = arr.filter((_, j) => j !== i);
        permute(rest, [...current, arr[i]]);
      }
    }
    permute([0,1,2], []);

    for (const perm of perms) {
      // Only keep if sorted descending (a≥b≥c) — i.e., if the sizes are non-increasing
      const permSizes = perm.map(i => sizes[i]);
      if (permSizes[0] >= permSizes[1] && permSizes[1] >= permSizes[2]) {
        orderings.push([allBridges[perm[0]], allBridges[perm[1]], allBridges[perm[2]]]);
      }
    }

    return orderings;
  }

  const bridgeOrderings = generateBridgeOrderings();

  // Build candidates: all start bridgeheads × all bridge orderings
  const candidates: Map<number, number>[] = [];

  for (const [bA_cand, bB_cand, bC_cand] of bridgeOrderings) {
    // For each ordering, try both start bridgeheads
    // We need a modified buildLocantMap that uses specific bridge ordering

    function buildLocantMapWith(
      startBH: number,
      otherBH: number,
      bridgeA: number[],
      bridgeB: number[],
      bridgeC: number[],
    ): Map<number, number> {
      const m = new Map<number, number>();
      let locNum = 1;

      m.set(startBH, locNum++);
      // Bridge A from startBH toward otherBH:
      // Need to determine traversal direction. If the first atom of bridgeA connects to startBH,
      // use forward; if the last atom connects to startBH, use reversed.
      // Check which end of bridgeA is adjacent to startBH in the ring graph.
      const aStart = bridgeA[0];
      const aPath = adjacentInRing(startBH, aStart) ? bridgeA : [...bridgeA].reverse();
      for (const a of aPath) m.set(a, locNum++);

      m.set(otherBH, locNum++);

      // Bridge B from otherBH toward startBH
      if (bridgeB.length > 0) {
        const bStart = bridgeB[0];
        const bPath = adjacentInRing(otherBH, bStart) ? bridgeB : [...bridgeB].reverse();
        for (const b of bPath) m.set(b, locNum++);
      }

      // Bridge C from otherBH
      if (bridgeC.length > 0) {
        const cStart = bridgeC[0];
        const cPath = adjacentInRing(otherBH, cStart) ? bridgeC : [...bridgeC].reverse();
        for (const c of cPath) m.set(c, locNum++);
      }

      return m;
    }

    candidates.push(buildLocantMapWith(bh1_orig, bh2_orig, bA_cand, bB_cand, bC_cand));
    candidates.push(buildLocantMapWith(bh2_orig, bh1_orig, bA_cand, bB_cand, bC_cand));
  }

  // Pick best by: heteroLocs → unsatLocs → pcgLocs → subLocs
  let bestMap = candidates[0];
  let bestEval = evalMap(candidates[0]);

  for (const cand of candidates.slice(1)) {
    const ev = evalMap(cand);
    let cmp = compareLocArr(ev.heteroLocs, bestEval.heteroLocs);
    if (cmp === 0) cmp = compareLocArr(ev.unsatLocs, bestEval.unsatLocs);
    if (cmp === 0) cmp = compareLocArr(ev.pcgLocs, bestEval.pcgLocs);
    if (cmp === 0) cmp = compareLocArr(ev.subLocs, bestEval.subLocs);
    if (cmp < 0) { bestMap = cand; bestEval = ev; }
  }

  // ── Assemble the name ──────────────────────────────────────────────────────

  // Collect heteroatoms sorted by locant (ascending)
  const heteroEntries: { locant: number; element: string }[] = [];
  for (const a of info.ringAtoms) {
    const el = atomById.get(a)?.element ?? "C";
    if (el !== "C") {
      const loc = bestMap.get(a)!;
      heteroEntries.push({ locant: loc, element: el });
    }
  }
  // Sort by IUPAC priority order (O > S > N) then by locant
  heteroEntries.sort((x, y) => {
    const px = VB_HETERO_PRIORITY[x.element] ?? 99;
    const py = VB_HETERO_PRIORITY[y.element] ?? 99;
    if (px !== py) return px - py;
    return x.locant - y.locant;
  });

  // Build heteroatom prefix (e.g. "1-aza", "2-oxa", "1,4-diaza")
  let heteroPrefix: string;
  if (heteroEntries.length > 0) {
    // Group by element
    const byEl = new Map<string, number[]>();
    for (const { element, locant } of heteroEntries) {
      const arr = byEl.get(element) ?? [];
      arr.push(locant);
      byEl.set(element, arr);
    }
    // Sort groups by element priority
    const groups = [...byEl.entries()].sort((a, b) =>
      (VB_HETERO_PRIORITY[a[0]] ?? 99) - (VB_HETERO_PRIORITY[b[0]] ?? 99)
    );
    const MULT: Record<number, string> = { 1: "", 2: "di", 3: "tri", 4: "tetra" };
    const parts: string[] = [];
    for (const [el, locs] of groups) {
      locs.sort((x, y) => x - y);
      const locStr = locs.join(",");
      const mult = MULT[locs.length] ?? `${locs.length}`;
      parts.push(`${locStr}-${mult}${VB_HETERO_PREFIX[el]}`);
    }
    heteroPrefix = parts.join("") + "bicyclo";
  } else {
    heteroPrefix = "bicyclo";
  }

  const parent = `${heteroPrefix}[${descriptor}]${alkaneBase}`;

  // Unsaturation: ene suffix
  // (Substituents handled by caller; here we just return the parent + locantOf)

  return {
    name: parent,
    locantOf: bestMap,
    descriptor,
    parent,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// T4 Stage 4: monospiro ring system naming
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Alkane stem names for spiro nomenclature.
 * spiro[a.b]<stem>ane where stem = parent for (a+b+1) atoms total.
 */
const SPIRO_ALKANE_STEMS: Record<number, string> = {
  5:  "pentane",
  6:  "hexane",
  7:  "heptane",
  8:  "octane",
  9:  "nonane",
  10: "decane",
  11: "undecane",
  12: "dodecane",
};

/**
 * Heteroatom replacement prefix for spiro nomenclature (same as von Baeyer).
 */
const SPIRO_HETERO_PREFIX: Record<string, string> = {
  O: "oxa",
  S: "thia",
  N: "aza",
};

const SPIRO_HETERO_PRIORITY: Record<string, number> = {
  O: 1, S: 2, N: 3,
};

export interface SpiroNaming {
  /** Full IUPAC name (e.g. "spiro[4.5]decane", "1,4-dioxaspiro[4.5]decane") */
  name: string;
  /** Map from ring atom index → IUPAC locant (1-based) */
  locantOf: Map<number, number>;
  /** Descriptor string, e.g. "4.5" */
  descriptor: string;
  /** The spiro atom index */
  spiroAtom: number;
}

/**
 * Detect the monospiro system in a ring system classified as "spiro".
 *
 * A monospiro system has exactly ONE atom shared between exactly two rings.
 * That atom has ring-internal degree 4 (bonded to 2 atoms in each ring).
 *
 * Returns:
 *   - spiroAtom: the index of the spiro atom
 *   - ring1, ring2: the two rings as arrays of atom indices (including the spiro atom)
 *   - null if the system is not a simple monospiro (e.g. dispiro, polyspiro)
 */
export function detectMonoSpiro(
  ringSys: RingSystemInfo,
  graph: MolGraph,
): { spiroAtom: number; ring1: number[]; ring2: number[] } | null {
  // Build ring-internal degree for all ring atoms
  const ringDeg = new Map<number, number>();
  for (const a of ringSys.atoms) ringDeg.set(a, 0);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      ringDeg.set(b.from, (ringDeg.get(b.from) ?? 0) + 1);
      ringDeg.set(b.to, (ringDeg.get(b.to) ?? 0) + 1);
    }
  }

  // Find atoms with ring degree 4 (the spiro atoms)
  const spiroCandidates: number[] = [];
  for (const [atom, deg] of ringDeg) {
    if (deg === 4) spiroCandidates.push(atom);
  }

  // Monospiro: exactly one spiro atom
  if (spiroCandidates.length !== 1) return null;
  const spiroAtom = spiroCandidates[0];

  // Build ring adjacency restricted to ring atoms
  const adj = new Map<number, number[]>();
  for (const a of ringSys.atoms) adj.set(a, []);
  for (const b of graph.bonds) {
    if (ringSys.atoms.has(b.from) && ringSys.atoms.has(b.to)) {
      adj.get(b.from)!.push(b.to);
      adj.get(b.to)!.push(b.from);
    }
  }

  // The spiro atom has 4 ring neighbors; these belong to two distinct rings.
  const spiroNeighbors = adj.get(spiroAtom) ?? [];
  if (spiroNeighbors.length !== 4) return null;

  // Partition spiro neighbors into two ring components by checking reachability
  // without crossing the spiro atom.
  const visited = new Set<number>([spiroAtom]);
  const component1 = new Set<number>();
  const q1 = [spiroNeighbors[0]];
  while (q1.length > 0) {
    const cur = q1.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    component1.add(cur);
    for (const nbr of adj.get(cur) ?? []) {
      if (!visited.has(nbr)) q1.push(nbr);
    }
  }

  const component2 = new Set<number>();
  for (const a of ringSys.atoms) {
    if (a !== spiroAtom && !component1.has(a)) component2.add(a);
  }

  // Verify: spiroNeighbors split cleanly between the two components
  const n1 = spiroNeighbors.filter(n => component1.has(n));
  const n2 = spiroNeighbors.filter(n => component2.has(n));
  if (n1.length !== 2 || n2.length !== 2) return null;

  // Build each ring as [spiroAtom, ...component atoms in cyclic order]
  // Walk each component as a simple cycle starting from spiroAtom
  function walkRing(start: number, comp: Set<number>): number[] | null {
    const ringAdj = new Map<number, number[]>();
    ringAdj.set(start, [...comp].filter(a => (adj.get(start) ?? []).includes(a)));
    for (const a of comp) {
      ringAdj.set(a, (adj.get(a) ?? []).filter(b => b === start || comp.has(b)));
    }
    // Walk the cycle
    const path: number[] = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    let prev = -1;
    const total = comp.size + 1; // include spiro atom
    for (let step = 0; step < total - 1; step++) {
      const nbrs = (ringAdj.get(cur) ?? []).filter(n => n !== prev && !seen.has(n));
      if (nbrs.length === 0) return null;
      // For start, we need to pick one direction (either neighbor of start in comp)
      const next = nbrs[0];
      path.push(next);
      seen.add(next);
      prev = cur;
      cur = next;
    }
    // Verify closure back to start
    if (!(ringAdj.get(cur) ?? []).includes(start)) return null;
    return path;
  }

  const r1 = walkRing(spiroAtom, component1);
  const r2 = walkRing(spiroAtom, component2);
  if (!r1 || !r2) return null;

  return { spiroAtom, ring1: r1, ring2: r2 };
}

/**
 * Name a monospiro ring system.
 *
 * Algorithm:
 * 1. Detect monospiro atom and two rings.
 * 2. Determine a (smaller ring's non-spiro count) and b (larger ring's non-spiro count).
 * 3. Enumerate candidate numberings: start at each atom adjacent to spiro in each ring,
 *    go around the smaller ring first, then the larger ring. Try both directions.
 * 4. Select the numbering that gives the lowest locants to: heteroatoms, then PCG, then subs.
 * 5. Assemble: heteroPrefix + "spiro[a.b]" + alkane stem.
 *
 * Returns null if:
 * - Not a simple monospiro
 * - Total atoms not in SPIRO_ALKANE_STEMS
 * - A heteroatom element is not in SPIRO_HETERO_PREFIX
 * - Could not build a valid numbering
 */
export function nameSpiro(
  ringSys: RingSystemInfo,
  graph: MolGraph,
  opts: {
    pcgAtoms?: Set<number>;     // ring atoms carrying PCG
    subAtoms?: Set<number>;     // ring atoms with substituents
    unsatBonds?: [number, number][];
  } = {},
): SpiroNaming | null {
  const detected = detectMonoSpiro(ringSys, graph);
  if (!detected) return null;

  const { spiroAtom, ring1, ring2 } = detected;

  // ring1 and ring2 each include the spiro atom.
  // Non-spiro atom count for each ring:
  const size1 = ring1.length - 1; // non-spiro atoms in ring1
  const size2 = ring2.length - 1; // non-spiro atoms in ring2

  // Determine "smaller" and "larger" (a ≤ b per IUPAC convention)
  const a = Math.min(size1, size2);
  const b = Math.max(size1, size2);
  const totalAtoms = a + b + 1;

  const alkaneBase = SPIRO_ALKANE_STEMS[totalAtoms];
  if (!alkaneBase) return null; // out of range

  // Check all ring heteroatoms can be expressed
  const atomById = new Map(graph.atoms.map(at => [at.index, at]));
  for (const at of ringSys.atoms) {
    const el = atomById.get(at)?.element ?? "C";
    if (el !== "C" && !(el in SPIRO_HETERO_PREFIX)) return null;
  }

  // Assign "smallerRing" and "largerRing" based on size
  const smallerRing = (size1 <= size2) ? ring1 : ring2;
  const largerRing  = (size1 <= size2) ? ring2 : ring1;

  // Non-spiro atoms of each ring (in cyclic order as returned by walkRing)
  // smallerRing = [spiroAtom, s1, s2, ..., sa]  (a non-spiro atoms)
  // largerRing  = [spiroAtom, l1, l2, ..., lb]  (b non-spiro atoms)
  const smallerNonSpiro = smallerRing.slice(1); // a atoms
  const largerNonSpiro  = largerRing.slice(1);  // b atoms

  /**
   * Build a locant map from a candidate numbering specification:
   * - smallStart: which end of smallerNonSpiro to start from (0 = forward, 1 = reverse)
   * - largeDir: which end of largerNonSpiro to start from (0 = forward, 1 = reverse)
   *
   * Numbering: s[start], s[start+1], ..., s[a-1], spiroAtom, l[0], l[1], ..., l[b-1]
   * (or with reversals)
   */
  function buildLocantMap(
    firstNonSpiro: number[],
    secondNonSpiro: number[],
    firstFwd: boolean,
    secondFwd: boolean,
  ): Map<number, number> {
    const m = new Map<number, number>();
    let loc = 1;

    // Number the first ring (a non-spiro atoms)
    const fAtoms = firstFwd ? firstNonSpiro : [...firstNonSpiro].reverse();
    for (const at of fAtoms) m.set(at, loc++);

    // Spiro atom gets locant a+1
    m.set(spiroAtom, loc++);

    // Number the second ring (b non-spiro atoms)
    const sAtoms = secondFwd ? secondNonSpiro : [...secondNonSpiro].reverse();
    for (const at of sAtoms) m.set(at, loc++);

    return m;
  }

  // Generate all candidate numberings: 4 combinations (2 small directions × 2 large directions)
  // ALSO try starting from different atoms in each ring (rotate the smaller ring's start)
  // since we need to find the atom that gives lowest heteroatom locants.
  //
  // For the smaller ring: we can start at any of the 'a' non-spiro atoms.
  // For the larger ring: we can traverse forward or backward from the ring1/ring2 ordering.
  //
  // In practice, the "start" of traversal around a ring is the atom ADJACENT to the spiro atom.
  // There are two atoms adjacent to spiro in the smaller ring (one on each side of the ring),
  // which correspond to "forward" and "reverse" directions.
  // But after we pick a direction, we can also pick WHICH adjacent atom is locant 1.
  // Actually since walkRing gives the ring in one cyclic order starting from spiroAtom,
  // the two directions ARE just "forward" and "reverse" of smallerNonSpiro.
  //
  // Key: in spiro[a.b]alkane, locant 1 is "next to the spiro atom in the smaller ring".
  // The spiro atom itself gets locant a+1. There's no ambiguity about WHERE the spiro is;
  // the only choices are:
  //   - Which direction around the smaller ring (CW vs CCW)
  //   - Which direction around the larger ring (CW vs CCW)
  // These 4 combinations are enumerated below.

  // Ring orderings to consider. IUPAC numbers the smaller ring first; but when
  // both rings are the SAME size, either ring may be numbered first and the
  // lowest-locant rules (heteroatoms → unsaturation → PCG → substituents)
  // decide which. Enumerate the swapped ordering only in that case.
  const orderings: [number[], number[]][] = [[smallerNonSpiro, largerNonSpiro]];
  if (a === b) orderings.push([largerNonSpiro, smallerNonSpiro]);

  const candidates: Map<number, number>[] = [];
  for (const [first, second] of orderings) {
    for (const firstFwd of [true, false]) {
      for (const secondFwd of [true, false]) {
        candidates.push(buildLocantMap(first, second, firstFwd, secondFwd));
      }
    }
  }

  // Evaluation function: extract locants for heteroatoms, PCG, subs
  function evalMap(m: Map<number, number>): {
    heteroLocs: number[];
    pcgLocs: number[];
    subLocs: number[];
    unsatLocs: number[];
  } {
    const heteroLocs: number[] = [];
    for (const at of ringSys.atoms) {
      const el = atomById.get(at)?.element ?? "C";
      if (el !== "C") {
        const loc = m.get(at);
        if (loc !== undefined) heteroLocs.push(loc);
      }
    }
    heteroLocs.sort((x, y) => x - y);

    const pcgLocs: number[] = [];
    if (opts.pcgAtoms) {
      for (const at of opts.pcgAtoms) {
        const loc = m.get(at);
        if (loc !== undefined) pcgLocs.push(loc);
      }
      pcgLocs.sort((x, y) => x - y);
    }

    const subLocs: number[] = [];
    if (opts.subAtoms) {
      for (const at of opts.subAtoms) {
        const loc = m.get(at);
        if (loc !== undefined) subLocs.push(loc);
      }
      subLocs.sort((x, y) => x - y);
    }

    const unsatLocs: number[] = [];
    if (opts.unsatBonds) {
      for (const [at1, at2] of opts.unsatBonds) {
        const la = m.get(at1) ?? 99;
        const lb = m.get(at2) ?? 99;
        unsatLocs.push(Math.min(la, lb));
      }
      unsatLocs.sort((x, y) => x - y);
    }

    return { heteroLocs, pcgLocs, subLocs, unsatLocs };
  }

  function compareLocArr(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
  }

  // Select best candidate: heteroLocs → unsatLocs → pcgLocs → subLocs
  let bestMap = candidates[0];
  let bestEval = evalMap(candidates[0]);

  for (const cand of candidates.slice(1)) {
    const ev = evalMap(cand);
    let cmp = compareLocArr(ev.heteroLocs, bestEval.heteroLocs);
    if (cmp === 0) cmp = compareLocArr(ev.unsatLocs, bestEval.unsatLocs);
    if (cmp === 0) cmp = compareLocArr(ev.pcgLocs, bestEval.pcgLocs);
    if (cmp === 0) cmp = compareLocArr(ev.subLocs, bestEval.subLocs);
    if (cmp < 0) { bestMap = cand; bestEval = ev; }
  }

  // ── Assemble the name ──────────────────────────────────────────────────────

  // Collect heteroatoms sorted by priority order (O > S > N) then locant
  const heteroEntries: { locant: number; element: string }[] = [];
  for (const at of ringSys.atoms) {
    const el = atomById.get(at)?.element ?? "C";
    if (el !== "C") {
      const loc = bestMap.get(at)!;
      heteroEntries.push({ locant: loc, element: el });
    }
  }
  heteroEntries.sort((x, y) => {
    const px = SPIRO_HETERO_PRIORITY[x.element] ?? 99;
    const py = SPIRO_HETERO_PRIORITY[y.element] ?? 99;
    if (px !== py) return px - py;
    return x.locant - y.locant;
  });

  // Build heteroatom prefix (e.g. "1-oxa", "1,4-dioxa", "1-aza")
  let heteroPrefix: string;
  if (heteroEntries.length > 0) {
    // Group by element (same priority → same group)
    const byEl = new Map<string, number[]>();
    for (const { element, locant } of heteroEntries) {
      const arr = byEl.get(element) ?? [];
      arr.push(locant);
      byEl.set(element, arr);
    }
    const groups = [...byEl.entries()].sort((a, b) =>
      (SPIRO_HETERO_PRIORITY[a[0]] ?? 99) - (SPIRO_HETERO_PRIORITY[b[0]] ?? 99)
    );
    const MULT: Record<number, string> = { 1: "", 2: "di", 3: "tri", 4: "tetra" };
    const parts: string[] = [];
    for (const [el, locs] of groups) {
      locs.sort((x, y) => x - y);
      const locStr = locs.join(",");
      const mult = MULT[locs.length] ?? `${locs.length}`;
      parts.push(`${locStr}-${mult}${SPIRO_HETERO_PREFIX[el]}`);
    }
    heteroPrefix = parts.join("") + "spiro";
  } else {
    heteroPrefix = "spiro";
  }

  const descriptor = `${a}.${b}`;
  const fullName = `${heteroPrefix}[${descriptor}]${alkaneBase}`;

  return {
    name: fullName,
    locantOf: bestMap,
    descriptor,
    spiroAtom,
  };
}

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
