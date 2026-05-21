import { describe, it, expect, vi } from "vitest";
import {
  appendSmilesToCanvas,
  appendPropertyBlock,
  addCaptionToLastFragment,
  captionAnchorX,
  setCaptionBlock,
  makeMultilineTextNode,
  type KetDoc,
} from "@/chem/canvas";

function ketDoc(): KetDoc {
  return {
    root: { nodes: [{ $ref: "mol0" }] },
    mol0: {
      atoms: [
        { location: [0, 0, 0] },
        { location: [2, -1, 0] },
        { location: [4, 0, 0] },
      ],
    },
  } as unknown as KetDoc;
}

describe("addCaptionToLastFragment", () => {
  it("adds a text node centered below the last fragment", () => {
    const ket = ketDoc();
    addCaptionToLastFragment(ket, "ethanol");
    const text = ket.root.nodes.find((n) => n.type === "text") as {
      data: { content: string; position: { x: number; y: number } };
    };
    expect(text).toBeDefined();
    // centered under fragment (0..4) for "ethanol"; y = min(0,-1,0) - 1.5
    expect(text.data.position.x).toBeCloseTo(captionAnchorX(0, 4, ["ethanol"]), 5);
    expect(text.data.position.y).toBe(-2.5);
    expect(text.data.content).toContain("ethanol");
  });

  it("captions the LAST molecule node when several exist", () => {
    const ket = {
      root: { nodes: [{ $ref: "mol0" }, { $ref: "mol1" }] },
      mol0: { atoms: [{ location: [0, 0, 0] }] },
      mol1: { atoms: [{ location: [10, -10, 0] }, { location: [12, -10, 0] }] },
    } as unknown as KetDoc;
    addCaptionToLastFragment(ket, "second");
    const text = ket.root.nodes.find((n) => n.type === "text") as {
      data: { position: { x: number } };
    };
    expect(text.data.position.x).toBeCloseTo(captionAnchorX(10, 12, ["second"]), 5); // mol1, not mol0
  });

  it("is a no-op when there is no molecule node", () => {
    const ket = { root: { nodes: [] } } as unknown as KetDoc;
    addCaptionToLastFragment(ket, "x");
    expect(ket.root.nodes).toHaveLength(0);
  });
});

function mockKetcher(ket: KetDoc) {
  return {
    addFragment: vi.fn<(s: string) => Promise<void>>(async () => {}),
    getKet: vi.fn(async () => JSON.stringify(ket)),
    setMolecule: vi.fn<(s: string) => Promise<void>>(async () => {}),
  };
}

describe("appendSmilesToCanvas", () => {
  it("adds via addFragment and does not setMolecule when no label", async () => {
    const k = mockKetcher(ketDoc());
    await appendSmilesToCanvas("CCO", undefined, k);
    expect(k.addFragment).toHaveBeenCalledWith("CCO");
    expect(k.setMolecule).not.toHaveBeenCalled();
  });

  it("adds then re-sets KET with a caption (capitalized) when a label is given", async () => {
    const k = mockKetcher(ketDoc());
    await appendSmilesToCanvas("CCO", "ethanol", k);
    expect(k.addFragment).toHaveBeenCalledWith("CCO");
    expect(k.getKet).toHaveBeenCalled();
    const setArg = k.setMolecule.mock.calls[0][0] as string;
    expect(setArg).toContain("Ethanol"); // first letter capitalized for display
    expect(setArg).toContain('"type":"text"');
  });

  it("throws when no editor is available", async () => {
    await expect(appendSmilesToCanvas("CCO", "x", undefined)).rejects.toThrow(/not ready/i);
  });
});

describe("appendPropertyBlock", () => {
  it("sets a single multi-line text node containing each line", async () => {
    const k = mockKetcher(ketDoc());
    await appendPropertyBlock(["Formula: C2H6O", "cLogP: -0.14"], undefined, k);
    expect(k.getKet).toHaveBeenCalled();
    const setArg = k.setMolecule.mock.calls[0][0] as string;
    expect(setArg).toContain("Formula: C2H6O");
    expect(setArg).toContain("cLogP: -0.14");
    expect(setArg).toContain('"type":"text"');
  });

  it("does not call setMolecule when lines is empty", async () => {
    const k = mockKetcher(ketDoc());
    await appendPropertyBlock([], undefined, k);
    expect(k.setMolecule).not.toHaveBeenCalled();
  });

  it("places the block under the molecule matching heavyAtoms", async () => {
    const ket = {
      root: { nodes: [{ $ref: "mol0" }, { $ref: "mol1" }] },
      mol0: { atoms: [{ location: [0, 0, 0] }] },
      mol1: { atoms: [{ location: [10, -5, 0] }, { location: [12, -5, 0] }] },
    } as unknown as KetDoc;
    const k = mockKetcher(ket);
    await appendPropertyBlock(["X: 1"], 2, k);
    const setArg = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const text = setArg.root.nodes.find((n) => n.type === "text") as {
      data: { position: { x: number; y: number } };
    };
    // centered on mol1 for "X: 1"; below its minY (-5 - 1.5 = -6.5)
    expect(text.data.position.x).toBeCloseTo(captionAnchorX(10, 12, ["X: 1"]), 5);
    expect(text.data.position.y).toBe(-6.5);
  });

  it("is a no-op when there is no molecule node", async () => {
    const k = mockKetcher({ root: { nodes: [] } } as unknown as KetDoc);
    await appendPropertyBlock(["X: 1"], undefined, k);
    expect(k.setMolecule).not.toHaveBeenCalled();
  });
});

describe("setCaptionBlock", () => {
  /** KET with one molecule (bbox 0..4) + an existing single-line name caption. */
  function ketWithNameCaption(): KetDoc {
    return {
      root: {
        nodes: [
          { $ref: "mol0" },
          // existing name caption centered below the molecule
          makeMultilineTextNode(["paracetamol"], 2, -2.5),
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
  }

  it("replaces the molecule's caption with ONE centered block", async () => {
    const k = mockKetcher(ketWithNameCaption());
    await setCaptionBlock(["paracetamol", "Formula: C8H9NO2"], 3, k);

    expect(k.setMolecule).toHaveBeenCalledTimes(1);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const texts = out.root.nodes.filter((n) => n.type === "text") as {
      data: { content: string; position: { x: number; y: number } };
    }[];

    // exactly ONE text node (old caption removed, new block added)
    expect(texts).toHaveLength(1);
    const block = texts[0];
    // centered on the fragment (0..4) for the 2-line block; below minY(-1) -1.5
    expect(block.data.position.x).toBeCloseTo(captionAnchorX(0, 4, ["paracetamol", "Formula: C8H9NO2"]), 5);
    expect(block.data.position.y).toBe(-2.5);
    // both lines present in the single block
    expect(block.data.content).toContain("paracetamol");
    expect(block.data.content).toContain("Formula: C8H9NO2");
  });

  it("removes the old caption even when lines is empty (no new block)", async () => {
    const k = mockKetcher(ketWithNameCaption());
    await setCaptionBlock([], 3, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    expect(out.root.nodes.filter((n) => n.type === "text")).toHaveLength(0);
  });

  it("targets the LAST fragment when matchHeavyAtoms is omitted", async () => {
    const ket = {
      root: { nodes: [{ $ref: "mol0" }, { $ref: "mol1" }] },
      mol0: { atoms: [{ location: [0, 0, 0] }] },
      mol1: { atoms: [{ location: [10, -5, 0] }, { location: [12, -5, 0] }] },
    } as unknown as KetDoc;
    const k = mockKetcher(ket);
    await setCaptionBlock(["x"], undefined, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const text = out.root.nodes.find((n) => n.type === "text") as {
      data: { position: { x: number } };
    };
    expect(text.data.position.x).toBeCloseTo(captionAnchorX(10, 12, ["x"]), 5); // centered over mol1
  });

  it("is a no-op when there is no molecule node", async () => {
    const k = mockKetcher({ root: { nodes: [] } } as unknown as KetDoc);
    await setCaptionBlock(["x"], undefined, k);
    expect(k.setMolecule).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no editor", async () => {
    await expect(setCaptionBlock(["x"], undefined, undefined)).resolves.toBeUndefined();
  });
});
