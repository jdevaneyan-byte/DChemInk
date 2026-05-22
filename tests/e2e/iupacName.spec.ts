import { test, expect } from "@playwright/test";
import type { Ketcher } from "ketcher-core";

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

/**
 * P1.3 Tier 1 — the live "IUPAC" row computes a systematic name from the drawn
 * structure (acyclic hydrocarbons) and shows a transparent "not yet supported"
 * reason otherwise. Drives the engine through the real adapter → engine path via
 * Ketcher's canvas, not the unit-test fixtures.
 */
test.describe("IUPAC name row (structure → name)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="ketcher-canvas"]');
    await page.waitForFunction(() => window.ketcher?.setMolecule != null, {
      timeout: 30_000,
    });
  });

  const supported: [string, string, string][] = [
    ["n-butane", "CCCC", "butane"],
    ["isobutane", "CC(C)C", "2-methylpropane"],
    ["but-2-ene", "CC=CC", "but-2-ene"],
  ];
  for (const [label, smiles, expected] of supported) {
    test(`names ${label}`, async ({ page }) => {
      await page.evaluate((s) => window.ketcher!.setMolecule(s), smiles);
      await expect(page.getByTestId("prop-iupac-value")).toHaveText(
        new RegExp(`^${expected}`),
        { timeout: 5_000 },
      );
    });
  }

  test("reports a ring as not yet supported", async ({ page }) => {
    await page.evaluate(() => window.ketcher!.setMolecule("c1ccccc1"));
    await expect(page.getByTestId("prop-iupac-value")).toContainText(
      /not yet supported.*ring/i,
      { timeout: 5_000 },
    );
  });

  test("reports oxygen as not yet supported", async ({ page }) => {
    await page.evaluate(() => window.ketcher!.setMolecule("CCO"));
    await expect(page.getByTestId("prop-iupac-value")).toContainText(
      /not yet supported.*oxygen/i,
      { timeout: 5_000 },
    );
  });
});
