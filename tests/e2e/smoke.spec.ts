import { test, expect } from "@playwright/test";
import type { Ketcher } from "ketcher-core";

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

test("Ketcher round-trip + PropertiesPanel shows MW", async ({ page }) => {
  await page.goto("/");

  await page.waitForSelector('[data-testid="ketcher-canvas"]');
  await page.waitForFunction(
    () => window.ketcher?.setMolecule != null,
    { timeout: 30_000 }
  );

  await page.evaluate(() => window.ketcher!.setMolecule("Cc1ccccc1"));

  // PropertiesPanel polls every 500 ms — give it time to refresh
  await expect(page.getByTestId("prop-molwt")).toContainText("92.14", {
    timeout: 5_000,
  });
  await expect(page.getByTestId("prop-formula")).toContainText("C7H8");
});
