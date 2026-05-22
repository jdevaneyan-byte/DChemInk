// src/chem/naming/functionalGroups.ts
import type { MolGraph } from "./graph";

export type GroupKind =
  | "acid"
  | "amide"
  | "nitrile"
  | "aldehyde"
  | "ketone"
  | "alcohol"
  | "amine"
  | "halide"
  | "ether"
  | "nitro";

export interface Group {
  kind: GroupKind;
  carbon: number;  // chain carbon that bears the group (for locant)
  atoms: number[]; // all atoms belonging to the group (excluded from chain except `carbon`)
  detail?: string; // e.g. halogen element "Cl", alkoxy stem "methoxy"
}

/** Suffix-eligible seniority, high→low. Prefix-only groups are 0 (never PCG). */
export const SENIORITY: Record<GroupKind, number> = {
  acid: 80,
  amide: 60,
  nitrile: 50,
  aldehyde: 40,
  ketone: 30,
  alcohol: 20,
  amine: 10,
  halide: 0,
  ether: 0,
  nitro: 0,
};

export interface Perception {
  groups: Group[];
  unsupported?: string; // set when an out-of-scope group/feature is present
}

const HALOGEN_PREFIX: Record<string, string> = {
  F: "fluoro",
  Cl: "chloro",
  Br: "bromo",
  I: "iodo",
};

/** The principal characteristic group kind (most senior present), or null. */
export function principalKind(groups: Group[]): GroupKind | null {
  const suffixable = groups.filter((g) => SENIORITY[g.kind] > 0);
  if (suffixable.length === 0) return null;
  return suffixable.reduce((a, b) => (SENIORITY[a.kind] >= SENIORITY[b.kind] ? a : b)).kind;
}

/**
 * Perceive functional groups present in the graph.
 *
 * Classification priority (each atom classified ONCE):
 * 1. Carbonyl carbon (C with =O):
 *    - + single-bonded O with H → acid
 *    - + single-bonded O bonded to another C (no H) → ESTER → unsupported (T2b)
 *    - + single-bonded O with charge → unsupported (charged)
 *    - + single-bonded N → amide
 *    - + at least one H on C (terminal) → aldehyde
 *    - else → ketone
 * 2. C triple-bonded to N → nitrile
 * 3. O with 1 H, single-bonded to exactly 1 C, not already a carbonyl O → alcohol
 * 4. O single-bonded to exactly 2 C → ether
 * 5. N with formal charge +, having =O and O⁻ neighbour → nitro
 * 6. N single-bonded to C only (not amide N, not nitro, not nitrile) → amine
 * 7. F/Cl/Br/I bonded to C → halide
 */
export function perceiveGroups(graph: MolGraph): Perception {
  const groups: Group[] = [];
  const atomsById = new Map(graph.atoms.map((a) => [a.index, a]));
  const bondsFrom = new Map<number, { to: number; order: 1 | 2 | 3 }[]>();
  for (const a of graph.atoms) bondsFrom.set(a.index, []);
  for (const b of graph.bonds) {
    bondsFrom.get(b.from)!.push({ to: b.to, order: b.order });
    bondsFrom.get(b.to)!.push({ to: b.from, order: b.order });
  }

  function neighbors(idx: number) {
    return bondsFrom.get(idx) ?? [];
  }

  // Track which atom indices have been classified as a group atom (not a carbon chain atom)
  const classified = new Set<number>(); // heteroatom indices already placed in a group

  // ── Pass 1: Carbonyl carbons, nitrile carbons ──────────────────────────────
  for (const atom of graph.atoms) {
    if (atom.element !== "C") continue;
    const nbs = neighbors(atom.index);

    // Look for C≡N (nitrile)
    const tripleN = nbs.find((b) => b.order === 3 && atomsById.get(b.to)?.element === "N");
    if (tripleN) {
      const nAtom = atomsById.get(tripleN.to)!;
      classified.add(nAtom.index);
      // The nitrile carbon IS part of the chain, the N is not
      groups.push({ kind: "nitrile", carbon: atom.index, atoms: [nAtom.index] });
      continue;
    }

    // Look for C=O (carbonyl)
    const doubleO = nbs.find((b) => b.order === 2 && atomsById.get(b.to)?.element === "O");
    if (!doubleO) continue;
    const oDouble = atomsById.get(doubleO.to)!;

    // Collect the remaining neighbours of the carbonyl carbon (not the =O)
    const otherNbs = nbs.filter((b) => b.to !== oDouble.index);

    // Acyl halide: a carbonyl carbon bonded to a halogen (R-C(=O)-X). Two-part /
    // functional-class names — deferred to T2b with esters & anhydrides.
    const acylHalide = otherNbs.find(
      (b) => b.order === 1 && HALOGEN_PREFIX[atomsById.get(b.to)?.element ?? ""],
    );
    if (acylHalide) {
      return {
        groups: [],
        unsupported: "contains an acyl halide — arrives in T2b (next milestone)",
      };
    }

    // Carbonic-acid derivatives — a carbonyl carbon bearing TWO or more
    // single-bonded heteroatoms (urea N-C(=O)-N, carbamate N-C(=O)-O, carbonate
    // O-C(=O)-O, carbamic acid). Specialized functional-class names — not yet supported.
    const heteroSingles = otherNbs.filter(
      (b) => b.order === 1 && ["O", "N"].includes(atomsById.get(b.to)?.element ?? ""),
    );
    if (heteroSingles.length >= 2) {
      return {
        groups: [],
        unsupported: "contains a carbonic-acid derivative (urea/carbamate/…) — not yet supported",
      };
    }

    // Look for single-bonded O or N among other neighbors
    const singleO = otherNbs.find((b) => b.order === 1 && atomsById.get(b.to)?.element === "O");
    const singleN = otherNbs.find((b) => b.order === 1 && atomsById.get(b.to)?.element === "N");

    if (singleO) {
      const oAtom = atomsById.get(singleO.to)!;
      if (oAtom.charge !== 0) {
        // Charged O (carboxylate): unsupported
        return { groups: [], unsupported: "contains a charged atom — later tier" };
      }
      // Check if the single-bonded O has an H → acid
      if (oAtom.hydrogens >= 1) {
        classified.add(oDouble.index);
        classified.add(oAtom.index);
        groups.push({
          kind: "acid",
          carbon: atom.index,
          atoms: [oDouble.index, oAtom.index],
        });
        continue;
      }
      // Single-bonded O with no H: check if it connects to another C → ester
      const oNbs = neighbors(oAtom.index).filter((b) => b.to !== atom.index);
      const conectsToC = oNbs.some((b) => atomsById.get(b.to)?.element === "C");
      if (conectsToC) {
        return {
          groups: [],
          unsupported: "contains an ester — esters arrive in T2b (next milestone)",
        };
      }
      // O with no H and no other C (unusual) — treat as unsupported charged
      return { groups: [], unsupported: "contains an unusual carbonyl-O — later tier" };
    }

    if (singleN) {
      const nAtom = atomsById.get(singleN.to)!;
      classified.add(oDouble.index);
      classified.add(nAtom.index);
      groups.push({ kind: "amide", carbon: atom.index, atoms: [oDouble.index, nAtom.index] });
      continue;
    }

    // No single-bonded O or N — aldehyde or ketone
    // Aldehyde: carbonyl C has at least one H
    if (atom.hydrogens >= 1) {
      classified.add(oDouble.index);
      groups.push({ kind: "aldehyde", carbon: atom.index, atoms: [oDouble.index] });
    } else {
      // Ketone: both other bonds go to C
      classified.add(oDouble.index);
      groups.push({ kind: "ketone", carbon: atom.index, atoms: [oDouble.index] });
    }
  }

  // ── Pass 2: O atoms (alcohol / ether) ────────────────────────────────────────
  for (const atom of graph.atoms) {
    if (atom.element !== "O") continue;
    if (classified.has(atom.index)) continue; // already part of carbonyl group

    const nbs = neighbors(atom.index);
    // Only single bonds expected for alcohol/ether
    const cNbs = nbs.filter((b) => b.order === 1 && atomsById.get(b.to)?.element === "C");

    if (atom.hydrogens >= 1 && cNbs.length === 1) {
      // Alcohol: O with 1H, single-bonded to exactly 1 C
      classified.add(atom.index);
      groups.push({ kind: "alcohol", carbon: cNbs[0].to, atoms: [atom.index] });
    } else if (atom.hydrogens === 0 && cNbs.length === 2) {
      // Ether: O single-bonded to exactly 2 C
      classified.add(atom.index);
      groups.push({ kind: "ether", carbon: cNbs[0].to, atoms: [atom.index] });
    }
  }

  // ── Pass 3: N atoms (nitro / amine) ──────────────────────────────────────────
  for (const atom of graph.atoms) {
    if (atom.element !== "N") continue;
    if (classified.has(atom.index)) continue; // already classified (amide/nitrile N)

    const nbs = neighbors(atom.index);

    // Nitro: N+ with =O and O⁻ among neighbours (attached to C)
    if (atom.charge === 1) {
      const hasDoubleO = nbs.some((b) => b.order === 2 && atomsById.get(b.to)?.element === "O");
      const negO = nbs.find(
        (b) => b.order === 1 && atomsById.get(b.to)?.element === "O" && atomsById.get(b.to)!.charge === -1,
      );
      const attachedC = nbs.find((b) => b.order === 1 && atomsById.get(b.to)?.element === "C");
      if (hasDoubleO && negO && attachedC) {
        classified.add(atom.index);
        classified.add(negO.to);
        const doubleOIdx = nbs.find(
          (b) => b.order === 2 && atomsById.get(b.to)?.element === "O",
        )!.to;
        classified.add(doubleOIdx);
        groups.push({ kind: "nitro", carbon: attachedC.to, atoms: [atom.index, doubleOIdx, negO.to] });
        continue;
      }
    }

    // Amine: N with only single bonds to C (no amide/nitro/nitrile character)
    const cNbs = nbs.filter((b) => b.order === 1 && atomsById.get(b.to)?.element === "C");
    if (cNbs.length >= 1 && nbs.every((b) => b.order === 1)) {
      // Make sure it's not an amide N (already classified) — classified check handles that
      classified.add(atom.index);
      groups.push({ kind: "amine", carbon: cNbs[0].to, atoms: [atom.index] });
    }
  }

  // ── Pass 4: Halogens ─────────────────────────────────────────────────────────
  for (const atom of graph.atoms) {
    if (!HALOGEN_PREFIX[atom.element]) continue;
    if (classified.has(atom.index)) continue;
    const nbs = neighbors(atom.index);
    const cNb = nbs.find((b) => atomsById.get(b.to)?.element === "C");
    if (cNb) {
      classified.add(atom.index);
      groups.push({ kind: "halide", carbon: cNb.to, atoms: [atom.index], detail: atom.element });
    }
  }

  return { groups };
}
