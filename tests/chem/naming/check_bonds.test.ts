import { describe, it, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { initRDKit } from "@/chem/rdkit";
import { graphFromSmiles } from "@/chem/naming/adapter";

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await initRDKit({ locateFile: (f) => require.resolve(`@rdkit/rdkit/dist/${f}`) });
});

describe("debug smiles", () => {
  it("pyrimidine", () => {
    const g = graphFromSmiles("c1ncncn1")!; // try pyrimidine
    console.log("pyrimidine c1ncncn1 atoms:", JSON.stringify(g.atoms.map(a=>({i:a.index,el:a.element,H:a.hydrogens,r:a.ringIds}))));
  });
  it("pyrimidine2", () => {
    const g = graphFromSmiles("c1cnccn1")!; 
    console.log("c1cnccn1 atoms:", JSON.stringify(g.atoms.map(a=>({i:a.index,el:a.element,H:a.hydrogens,r:a.ringIds}))));
  });
  it("pyrrole", () => {
    const g = graphFromSmiles("[nH]1cccc1")!;
    console.log("pyrrole atoms:", JSON.stringify(g.atoms.map(a=>({i:a.index,el:a.element,H:a.hydrogens,r:a.ringIds}))));
  });
  it("furan", () => {
    const g = graphFromSmiles("c1ccoc1")!;
    console.log("furan atoms:", JSON.stringify(g.atoms.map(a=>({i:a.index,el:a.element,H:a.hydrogens,r:a.ringIds}))));
    console.log("furan bonds:", JSON.stringify(g.bonds));
  });
});
