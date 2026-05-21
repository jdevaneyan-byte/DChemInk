import { test, expect } from "@playwright/test";
import type { Ketcher } from "ketcher-core";

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

// Minimal benzene encoded as CDXML — enough to exercise Ketcher's CDXML
// parser end-to-end via the file-import button.
const BENZENE_CDXML = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML>
  <page>
    <fragment>
      <n id="1" Element="6" p="0.000  0.000"/>
      <n id="2" Element="6" p="1.500  0.000"/>
      <n id="3" Element="6" p="2.250  1.300"/>
      <n id="4" Element="6" p="1.500  2.600"/>
      <n id="5" Element="6" p="0.000  2.600"/>
      <n id="6" Element="6" p="-0.750  1.300"/>
      <b B="1" E="2" Order="2"/>
      <b B="2" E="3" Order="1"/>
      <b B="3" E="4" Order="2"/>
      <b B="4" E="5" Order="1"/>
      <b B="5" E="6" Order="2"/>
      <b B="6" E="1" Order="1"/>
    </fragment>
  </page>
</CDXML>`;

test("file import: load a CDXML benzene via the Open button", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="ketcher-canvas"]');
  await page.waitForFunction(() => window.ketcher?.setMolecule != null, {
    timeout: 30_000,
  });

  // Click the import button (triggers the hidden file input), then attach
  // a CDXML payload directly to the input — sidesteps the OS file dialog.
  await page.getByTestId("file-import-button").click();
  await page.getByTestId("file-import-input").setInputFiles({
    name: "benzene.cdxml",
    mimeType: "application/xml",
    buffer: Buffer.from(BENZENE_CDXML, "utf8"),
  });

  // Give Ketcher a moment to parse + render
  await page.waitForTimeout(1500);

  const smiles = await page.evaluate(() => window.ketcher!.getSmiles());
  // Ketcher emits either aromatic `c1ccccc1` (perception on) or Kekulé
  // `c1c=cc=cc=1` (alternating singles + doubles, atoms lowercase aromatic).
  // Either form has a 1-numbered ring with 6 carbons.
  expect(smiles.toLowerCase()).toMatch(/c1[c=]{5,9}1/);
  const cCount = (smiles.match(/c/gi) ?? []).length;
  expect(cCount).toBeGreaterThanOrEqual(6);
});
