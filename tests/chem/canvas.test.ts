import { describe, it, expect, vi } from "vitest";
import {
  appendSmilesToCanvas,
  setCaptionBlock,
  makeCaptionSgroup,
  joinCaptionLines,
  CAPTION_FIELD,
  type KetDoc,
  type KetMolecule,
  type KetSgroup,
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

/** Caption Data S-groups on a molecule node (fieldName === CAPTION_FIELD). */
function captionSgroups(mol: KetMolecule | undefined): KetSgroup[] {
  return (mol?.sgroups ?? []).filter(
    (sg) => sg.type === "DAT" && sg.fieldName === CAPTION_FIELD,
  );
}

describe("makeCaptionSgroup", () => {
  it("binds to atoms 0..count-1 with the caption field + data", () => {
    const sg = makeCaptionSgroup("Ethanol", 3);
    expect(sg.type).toBe("DAT");
    expect(sg.atoms).toEqual([0, 1, 2]);
    expect(sg.fieldName).toBe(CAPTION_FIELD);
    expect(sg.fieldData).toBe("Ethanol");
  });
});

describe("joinCaptionLines", () => {
  it("joins non-empty lines with a separator into one line", () => {
    expect(joinCaptionLines(["Paracetamol", "Formula: C8H9NO2"])).toBe(
      "Paracetamol · Formula: C8H9NO2",
    );
  });
  it("drops empty lines", () => {
    expect(joinCaptionLines(["", "MW: 46", ""])).toBe("MW: 46");
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

  it("binds a Name Data S-group (capitalized) to the new fragment", async () => {
    const k = mockKetcher(ketDoc());
    await appendSmilesToCanvas("CCO", "ethanol", k);
    expect(k.addFragment).toHaveBeenCalledWith("CCO");
    expect(k.getKet).toHaveBeenCalled();

    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const sgs = captionSgroups(out.mol0 as KetMolecule);
    expect(sgs).toHaveLength(1);
    expect(sgs[0].fieldData).toBe("Ethanol"); // first letter capitalized
    // bound to all atoms of the (3-atom) fragment, per its own 0-based index space
    expect(sgs[0].atoms).toEqual([0, 1, 2]);
    // no loose text node was added (S-group lives inside the molecule)
    expect(out.root.nodes.some((n) => n.type === "text")).toBe(false);
  });

  it("binds the S-group to the LAST molecule node when several exist", async () => {
    const ket = {
      root: { nodes: [{ $ref: "mol0" }, { $ref: "mol1" }] },
      mol0: { atoms: [{ location: [0, 0, 0] }] },
      mol1: { atoms: [{ location: [10, -10, 0] }, { location: [12, -10, 0] }] },
    } as unknown as KetDoc;
    const k = mockKetcher(ket);
    await appendSmilesToCanvas("CC", "second", k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    // mol1 (the last node) carries the caption; mol0 does not
    expect(captionSgroups(out.mol1 as KetMolecule)).toHaveLength(1);
    expect(captionSgroups(out.mol0 as KetMolecule)).toHaveLength(0);
    expect(captionSgroups(out.mol1 as KetMolecule)[0].atoms).toEqual([0, 1]);
  });

  it("throws when no editor is available", async () => {
    await expect(appendSmilesToCanvas("CCO", "x", undefined)).rejects.toThrow(/not ready/i);
  });
});

describe("setCaptionBlock", () => {
  /** KET with one molecule that already carries a Name caption S-group. */
  function ketWithNameCaption(): KetDoc {
    return {
      root: { nodes: [{ $ref: "mol0" }] },
      mol0: {
        atoms: [
          { location: [0, 0, 0] },
          { location: [2, -1, 0] },
          { location: [4, 0, 0] },
        ],
        sgroups: [makeCaptionSgroup("Paracetamol", 3)],
      },
    } as unknown as KetDoc;
  }

  it("replaces the molecule's caption with ONE combined bound S-group", async () => {
    const k = mockKetcher(ketWithNameCaption());
    await setCaptionBlock(["Paracetamol", "Formula: C8H9NO2"], 3, k);

    expect(k.setMolecule).toHaveBeenCalledTimes(1);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const sgs = captionSgroups(out.mol0 as KetMolecule);
    // exactly ONE caption S-group (old one removed, new combined one added)
    expect(sgs).toHaveLength(1);
    expect(sgs[0].fieldData).toBe("Paracetamol · Formula: C8H9NO2");
    expect(sgs[0].atoms).toEqual([0, 1, 2]);
    // still no loose text node
    expect(out.root.nodes.some((n) => n.type === "text")).toBe(false);
  });

  it("does not stack duplicates when re-pasting", async () => {
    const k = mockKetcher(ketWithNameCaption());
    await setCaptionBlock(["Paracetamol", "MW: 151"], 3, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    expect(captionSgroups(out.mol0 as KetMolecule)).toHaveLength(1);
  });

  it("removes the old caption even when lines is empty (no new S-group)", async () => {
    const k = mockKetcher(ketWithNameCaption());
    await setCaptionBlock([], 3, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    expect(captionSgroups(out.mol0 as KetMolecule)).toHaveLength(0);
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
    expect(captionSgroups(out.mol1 as KetMolecule)).toHaveLength(1);
    expect(captionSgroups(out.mol0 as KetMolecule)).toHaveLength(0);
  });

  it("preserves non-caption (chemistry) S-groups on the molecule", async () => {
    const ket = {
      root: { nodes: [{ $ref: "mol0" }] },
      mol0: {
        atoms: [{ location: [0, 0, 0] }, { location: [2, 0, 0] }],
        sgroups: [
          { type: "SUP", atoms: [0, 1], name: "Bn" },
          makeCaptionSgroup("Old", 2),
        ],
      },
    } as unknown as KetDoc;
    const k = mockKetcher(ket);
    await setCaptionBlock(["New"], undefined, k);
    const out = JSON.parse(k.setMolecule.mock.calls[0][0] as string) as KetDoc;
    const all = (out.mol0 as KetMolecule).sgroups ?? [];
    expect(all.some((sg) => sg.type === "SUP")).toBe(true); // chemistry sgroup kept
    expect(captionSgroups(out.mol0 as KetMolecule)).toHaveLength(1);
    expect(captionSgroups(out.mol0 as KetMolecule)[0].fieldData).toBe("New");
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
