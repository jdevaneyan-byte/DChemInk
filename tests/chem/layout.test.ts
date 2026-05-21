import { describe, it, expect, vi } from "vitest";
import {
  fragmentBBox,
  nearestFragmentIndex,
  gridTranslations,
  cleanUpCanvas,
  type BBox,
} from "@/chem/layout";
import type { KetDoc, KetMolecule } from "@/chem/canvas";

describe("fragmentBBox", () => {
  it("computes min/max from atom locations", () => {
    const mol = {
      atoms: [
        { location: [0, 0, 0] },
        { location: [2, -1, 0] },
        { location: [4, 3, 0] },
      ],
    } as unknown as KetMolecule;
    expect(fragmentBBox(mol)).toEqual({ minX: 0, maxX: 4, minY: -1, maxY: 3 });
  });

  it("returns null with no positioned atoms", () => {
    expect(fragmentBBox({ atoms: [] } as unknown as KetMolecule)).toBeNull();
    expect(fragmentBBox(undefined)).toBeNull();
  });
});

describe("nearestFragmentIndex", () => {
  it("returns the fragment a caption sits below (B, not A)", () => {
    // A: centered around (0,0); B: centered around (10,0). Caption is just
    // below B (overlaps B's x-range, sits below B's minY).
    const fragments: BBox[] = [
      { minX: -1, maxX: 1, minY: -1, maxY: 1 }, // A
      { minX: 9, maxX: 11, minY: -1, maxY: 1 }, // B
    ];
    const idx = nearestFragmentIndex({ x: 10, y: -3 }, fragments);
    expect(idx).toBe(1);
  });

  it("prefers the fragment above the text over a closer one beside it", () => {
    const fragments: BBox[] = [
      // A is closer in raw distance but to the side (no x-overlap, not above).
      { minX: 5, maxX: 6, minY: -3, maxY: -3 },
      // B sits directly above the caption with x-overlap.
      { minX: 0, maxX: 4, minY: 0, maxY: 2 },
    ];
    const idx = nearestFragmentIndex({ x: 2, y: -2 }, fragments);
    expect(idx).toBe(1);
  });

  it("falls back to globally nearest when none are above with overlap", () => {
    const fragments: BBox[] = [
      { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      { minX: 20, maxX: 21, minY: 20, maxY: 21 },
    ];
    expect(nearestFragmentIndex({ x: 0.5, y: 5 }, fragments)).toBe(0);
  });

  it("returns -1 when there are no positioned fragments", () => {
    expect(nearestFragmentIndex({ x: 0, y: 0 }, [null, null])).toBe(-1);
  });
});

describe("gridTranslations", () => {
  it("places N fragments into rows/cols of distinct, non-overlapping cells", () => {
    // 5 unit-square fragments all stacked at the origin; 3 cols, pad 2.
    const bboxes: BBox[] = Array.from({ length: 5 }, () => ({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
    }));
    const t = gridTranslations(bboxes, 3, 2);
    expect(t).toHaveLength(5);

    // cell size = (maxW=1 + pad=2) x (maxH=1 + pad=2) = 3 x 3.
    // Resulting top-left corners (minX, maxY) after translation:
    const corners = bboxes.map((bb, i) => ({
      x: bb.minX + t[i].dx,
      y: bb.maxY + t[i].dy,
    }));
    // Row 0: cols 0,1,2 -> x = 0,3,6 ; y = 1 (anchor top)
    expect(corners[0]).toEqual({ x: 0, y: 1 });
    expect(corners[1]).toEqual({ x: 3, y: 1 });
    expect(corners[2]).toEqual({ x: 6, y: 1 });
    // Row 1 (downward = decreasing y by one cell): x = 0,3 ; y = 1 - 3 = -2
    expect(corners[3]).toEqual({ x: 0, y: -2 });
    expect(corners[4]).toEqual({ x: 3, y: -2 });

    // All cells distinct.
    const keys = new Set(corners.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(5);
  });

  it("gives null fragments a zero translation", () => {
    const t = gridTranslations([null, { minX: 0, maxX: 1, minY: 0, maxY: 1 }], 3, 2);
    expect(t[0]).toEqual({ dx: 0, dy: 0 });
  });
});

function mockKetcher(ket: KetDoc) {
  return {
    addFragment: vi.fn<(s: string) => Promise<void>>(async () => {}),
    getKet: vi.fn(async () => JSON.stringify(ket)),
    setMolecule: vi.fn<(s: string) => Promise<void>>(async () => {}),
    layout: vi.fn<() => Promise<void>>(async () => {}),
  };
}

describe("cleanUpCanvas", () => {
  it("calls layout and re-anchors the caption under its fragment (text preserved)", async () => {
    const ket = {
      root: {
        nodes: [
          { $ref: "mol0" },
          {
            type: "text",
            data: {
              content: JSON.stringify({
                blocks: [{ text: "ethanol" }],
                entityMap: {},
              }),
              position: { x: 2, y: -3, z: 0 },
            },
          },
        ],
      },
      mol0: {
        atoms: [
          { location: [0, 0, 0] },
          { location: [2, -1, 0] },
          { location: [4, 0, 0] },
        ],
      },
    } as unknown as KetDoc;

    const k = mockKetcher(ket);
    await cleanUpCanvas({ grid: false }, k);

    expect(k.layout).toHaveBeenCalled();
    expect(k.setMolecule).toHaveBeenCalled();
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const text = out.root.nodes.find((n) => n.type === "text") as {
      data: { content: string; position: { x: number; y: number } };
    };
    expect(text).toBeDefined();
    expect(text.data.content).toContain("ethanol");
    // re-anchored under mol0: minX = 0, y = minY(-1) - 1.5 = -2.5
    expect(text.data.position.x).toBe(0);
    expect(text.data.position.y).toBe(-2.5);
  });

  it("is a no-op when no editor is available", async () => {
    await expect(cleanUpCanvas({ grid: false }, undefined)).resolves.toBeUndefined();
  });

  it("translates fragments into a grid when grid: true", async () => {
    const ket = {
      root: {
        nodes: [{ $ref: "mol0" }, { $ref: "mol1" }],
      },
      mol0: { atoms: [{ location: [0, 0, 0] }, { location: [1, 1, 0] }] },
      mol1: { atoms: [{ location: [0, 0, 0] }, { location: [1, 1, 0] }] },
    } as unknown as KetDoc;
    const k = mockKetcher(ket);
    await cleanUpCanvas({ grid: true }, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const m0 = out.mol0 as KetMolecule;
    const m1 = out.mol1 as KetMolecule;
    // mol0 stays at anchor; mol1 shifts right by one cell (width 1 + pad 2 = 3).
    expect(fragmentBBox(m0)).toEqual({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
    expect(fragmentBBox(m1)).toEqual({ minX: 3, maxX: 4, minY: 0, maxY: 1 });
  });
});
