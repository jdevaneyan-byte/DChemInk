import { test, expect } from "@playwright/test";
import type { Ketcher } from "ketcher-core";

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

/**
 * P1.3 Tier 1 + Tier 2 — the live "IUPAC" row computes a systematic name from
 * the drawn structure (acyclic hydrocarbons + functional groups) and shows a
 * transparent "not yet supported" reason otherwise. Drives the engine through
 * the real adapter → engine path via Ketcher's canvas.
 */
test.describe("IUPAC name row (structure → name)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="ketcher-canvas"]');
    await page.waitForFunction(() => window.ketcher?.setMolecule != null, {
      timeout: 30_000,
    });
  });

  // ── Tier 1: acyclic hydrocarbons ──────────────────────────────────────────
  const tier1: [string, string, string][] = [
    ["n-butane", "CCCC", "butane"],
    ["isobutane", "CC(C)C", "2-methylpropane"],
    ["but-2-ene", "CC=CC", "but-2-ene"],
  ];
  for (const [label, smiles, expected] of tier1) {
    test(`names ${label}`, async ({ page }) => {
      await page.evaluate((s) => window.ketcher!.setMolecule(s), smiles);
      await expect(page.getByTestId("prop-iupac-value")).toHaveText(
        new RegExp(`^${expected}`),
        { timeout: 5_000 },
      );
    });
  }

  // ── Tier 2: functional groups ─────────────────────────────────────────────
  test("names ethanol (CCO)", async ({ page }) => {
    await page.evaluate(() => window.ketcher!.setMolecule("CCO"));
    await expect(page.getByTestId("prop-iupac-value")).toHaveText(
      /^ethanol/,
      { timeout: 5_000 },
    );
  });

  test("names propan-2-one (CC(=O)C)", async ({ page }) => {
    await page.evaluate(() => window.ketcher!.setMolecule("CC(=O)C"));
    await expect(page.getByTestId("prop-iupac-value")).toHaveText(
      /^propan-2-one/,
      { timeout: 5_000 },
    );
  });

  test("reports an ester as not yet supported (T2b)", async ({ page }) => {
    // CC(=O)OC = methyl acetate (ester) — deferred to T2b
    await page.evaluate(() => window.ketcher!.setMolecule("CC(=O)OC"));
    await expect(page.getByTestId("prop-iupac-value")).toContainText(
      /not yet supported/i,
      { timeout: 5_000 },
    );
  });

  // ── Rejections ────────────────────────────────────────────────────────────
  test("reports a ring as not yet supported", async ({ page }) => {
    await page.evaluate(() => window.ketcher!.setMolecule("c1ccccc1"));
    await expect(page.getByTestId("prop-iupac-value")).toContainText(
      /not yet supported.*ring/i,
      { timeout: 5_000 },
    );
  });
});
