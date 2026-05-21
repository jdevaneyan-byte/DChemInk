import { describe, it, expect } from "vitest";
import { reanchorCaptionsInKet, fragmentBBox } from "@/chem/layout";
import { makeMultilineTextNode, type KetDoc, type KetNode } from "@/chem/canvas";

/** A molecule fragment whose bbox is minX=0,maxX=4,minY=-1,maxY=1; center x=2. */
function mol() {
  return {
    atoms: [
      { location: [0, 0, 0] },
      { location: [2, -1, 0] },
      { location: [4, 1, 0] },
    ],
  };
}

function textPos(node: KetNode): { x: number; y: number } {
  return (node.data as { position: { x: number; y: number } }).position;
}

function makeKet(textNodes: KetNode[]): KetDoc {
  return {
    root: { nodes: [{ $ref: "mol0" }, ...textNodes] },
    mol0: mol(),
  } as unknown as KetDoc;
}

describe("reanchorCaptionsInKet", () => {
  it("moves a caption sitting ABOVE its molecule (post-flip) to centered-below", () => {
    // Simulate a flip: the name caption is mirrored above the molecule.
    const caption = makeMultilineTextNode(["ethanol"], 2, 3);
    const ket = makeKet([caption]);

    expect(reanchorCaptionsInKet(ket)).toBe(true);

    const text = ket.root.nodes.find((n) => n.type === "text") as KetNode;
    const pos = textPos(text);
    const bb = fragmentBBox(ket.mol0 as never)!;
    // single-line caption → centered on fragment center x = 2
    expect(pos.x).toBe((bb.minX + bb.maxX) / 2);
    expect(pos.x).toBe(2);
    // below the molecule: y strictly less than the molecule's minY
    expect(pos.y).toBeLessThan(bb.minY);
    expect(pos.y).toBe(bb.minY - 1.5); // -2.5
  });

  it("is idempotent: an already-centered-below caption returns false, unchanged", () => {
    // minY = -1, gap 1.5 → y = -2.5; centered x = 2.
    const caption = makeMultilineTextNode(["ethanol"], 2, -2.5);
    const ket = makeKet([caption]);
    const before = JSON.stringify(textPos(ket.root.nodes[1] as KetNode));

    expect(reanchorCaptionsInKet(ket)).toBe(false);
    // running it twice in a row still false
    expect(reanchorCaptionsInKet(ket)).toBe(false);

    const after = JSON.stringify(textPos(ket.root.nodes[1] as KetNode));
    expect(after).toBe(before);
  });

  it("stacks two captions under the same fragment at distinct y, both below", () => {
    const c1 = makeMultilineTextNode(["alpha"], 2, 5);
    const c2 = makeMultilineTextNode(["beta"], 2, 6);
    const ket = makeKet([c1, c2]);

    expect(reanchorCaptionsInKet(ket)).toBe(true);

    const texts = ket.root.nodes.filter((n) => n.type === "text") as KetNode[];
    const y1 = textPos(texts[0]).y;
    const y2 = textPos(texts[1]).y;
    const bb = fragmentBBox(ket.mol0 as never)!;
    expect(y1).not.toBe(y2); // distinct
    expect(y1).toBeLessThan(bb.minY);
    expect(y2).toBeLessThan(bb.minY);
    // second caption stacks below the first
    expect(y2).toBeLessThan(y1);
  });

  it("left-aligns multi-line captions at minX; single-line are centered", () => {
    const multi = makeMultilineTextNode(["Label: x", "MW: 46"], 2, 5);
    const ket = makeKet([multi]);

    expect(reanchorCaptionsInKet(ket)).toBe(true);

    const text = ket.root.nodes.find((n) => n.type === "text") as KetNode;
    const bb = fragmentBBox(ket.mol0 as never)!;
    // multi-line → left-aligned at minX (0), not centered (2)
    expect(textPos(text).x).toBe(bb.minX);
    expect(textPos(text).x).toBe(0);

    // contrast: single-line centers
    const single = makeMultilineTextNode(["name"], 0, 5);
    const ket2 = makeKet([single]);
    reanchorCaptionsInKet(ket2);
    const t2 = ket2.root.nodes.find((n) => n.type === "text") as KetNode;
    expect(textPos(t2).x).toBe((bb.minX + bb.maxX) / 2);
    expect(textPos(t2).x).toBe(2);
  });

  it("leaves a caption with no nearby fragment untouched (returns false for it)", () => {
    // No molecule node at all → no fragments.
    const ket = {
      root: { nodes: [makeMultilineTextNode(["orphan"], 9, 9)] },
    } as unknown as KetDoc;
    expect(reanchorCaptionsInKet(ket)).toBe(false);
    expect(textPos(ket.root.nodes[0] as KetNode)).toEqual({ x: 9, y: 9, z: 0 });
  });

  it("preserves caption text content while repositioning", () => {
    const caption = makeMultilineTextNode(["ethanol"], 2, 3);
    const ket = makeKet([caption]);
    reanchorCaptionsInKet(ket);
    const text = ket.root.nodes.find((n) => n.type === "text") as KetNode;
    const content = (text.data as { content: string }).content;
    expect(content).toContain("ethanol");
  });
});
