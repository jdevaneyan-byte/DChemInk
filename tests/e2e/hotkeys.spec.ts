import { test, expect } from "@playwright/test";
import type { Ketcher } from "ketcher-core";

declare global {
  interface Window {
    ketcher?: Ketcher;
    __dcheminkHotkeysReady?: boolean;
  }
}

async function waitForKetcher(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="ketcher-canvas"]');
  await page.waitForFunction(() => window.ketcher?.setMolecule != null, {
    timeout: 30_000,
  });
  // useHotkeys' effect installs the document keydown listener after mount.
  await page.waitForFunction(() => window.__dcheminkHotkeysReady === true, {
    timeout: 5_000,
  });
}

test("? opens the hotkeys help overlay, filters, then closes on Esc", async ({
  page,
}) => {
  await waitForKetcher(page);

  await page.keyboard.press("?");
  const overlay = page.getByTestId("hotkeys-help-overlay");
  await expect(overlay).toBeVisible();

  // The 'm' → Me LABELTEXT row is present
  await expect(overlay.getByTestId("hotkey-row-LABELTEXT-m")).toBeVisible();

  // Filtering narrows the list
  await page.getByTestId("hotkeys-help-filter").fill("benzene");
  await expect(
    overlay.locator('[data-testid="hotkey-row-LABELTEXT-m"]'),
  ).toHaveCount(0);
  await expect(
    overlay.locator('[data-testid="hotkey-row-SPROUT-3"]'),
  ).toBeVisible();

  // Esc closes the overlay
  await page.keyboard.press("Escape");
  await expect(overlay).not.toBeVisible();
});

test("3 sprouts a benzene ring onto an empty canvas", async ({ page }) => {
  await waitForKetcher(page);

  const before = await page.evaluate(() => window.ketcher!.getSmiles());
  expect(String(before).trim()).toBe("");

  await page.keyboard.press("3");

  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => window.ketcher!.getSmiles());
  expect(after.toLowerCase()).toContain("c1ccccc1");
});

test("= oxidizes the hovered atom to C=O (toluene → benzaldehyde)", async ({
  page,
}) => {
  await waitForKetcher(page);

  await page.evaluate(() => window.ketcher!.setMolecule("Cc1ccccc1"));
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { struct?: () => { atoms?: { size: number } } };
        }
      ).editor;
      return editor?.struct?.()?.atoms?.size === 7;
    },
    { timeout: 5_000 },
  );

  // Hover the methyl carbon (struct atom 0)
  const pos = await page.evaluate(() => {
    const editor = (
      window.ketcher as unknown as {
        editor?: {
          findItem?: (ev: MouseEvent) => { map?: string; id?: number } | null;
        };
      }
    ).editor!;
    for (let y = 0; y < window.innerHeight; y += 6) {
      for (let x = 0; x < window.innerWidth; x += 6) {
        const r = editor.findItem!({ clientX: x, clientY: y } as MouseEvent);
        if (r?.map === "atoms" && r.id === 0) return { x, y };
      }
    }
    return null;
  });
  expect(pos).not.toBeNull();
  if (!pos) return;

  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(150);
  await page.keyboard.press("=");
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => window.ketcher!.getSmiles());
  // Benzaldehyde: one =O on a ring-attached carbon, single connected fragment.
  expect(after).toContain("=O");
  expect(after.toLowerCase()).toContain("c1ccccc1");
  expect(after).not.toContain(".");
  // Must NOT have an extra CH2 between ring and carbonyl (that'd be the
  // SPROUT 'add carbonyl' result, phenylacetaldehyde).
  expect(after.replace(/[()]/g, "")).not.toMatch(/Cc1ccccc1C=O|CC=O/i);
});

test("2 sprouts a carbonyl BONDED to the hovered atom (no selection needed)", async ({
  page,
}) => {
  await waitForKetcher(page);

  // Ethylbenzene
  await page.evaluate(() => window.ketcher!.setMolecule("CCc1ccccc1"));
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { struct?: () => { atoms?: { size: number } } };
        }
      ).editor;
      return editor?.struct?.()?.atoms?.size === 8;
    },
    { timeout: 5_000 },
  );

  // Sweep the mouse to find the on-screen position of atom 0 (the terminal
  // methyl C). Once we land on it, the document-level mousemove listener has
  // updated our hover state.
  const found = await page.evaluate(async () => {
    const editor = (
      window.ketcher as unknown as {
        editor?: {
          findItem?: (ev: MouseEvent) => { map?: string; id?: number } | null;
        };
      }
    ).editor!;
    for (let y = 0; y < window.innerHeight; y += 8) {
      for (let x = 0; x < window.innerWidth; x += 8) {
        const fakeEv = { clientX: x, clientY: y, pageX: x, pageY: y } as MouseEvent;
        const r = editor.findItem!(fakeEv);
        if (r?.map === "atoms" && r.id === 0) return { x, y };
      }
    }
    return null;
  });
  expect(found).not.toBeNull();
  if (!found) return;

  // Move the real cursor there so the document mousemove fires for our hook
  await page.mouse.move(found.x, found.y);
  await page.waitForTimeout(150);

  await page.keyboard.press("2");
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => window.ketcher!.getSmiles());
  // Result should contain both the benzene ring and a carbonyl, all in ONE
  // connected fragment (no '.').
  expect(after.toLowerCase()).toContain("c1ccccc1");
  expect(after).toContain("=O");
  expect(after).not.toContain(".");
});

test("3 sprouts a benzene ring BONDED to the selected atom", async ({ page }) => {
  await waitForKetcher(page);

  // Start with methane on the canvas
  await page.evaluate(() => window.ketcher!.setMolecule("C"));
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { struct?: () => { atoms?: { size: number } } };
        }
      ).editor;
      return editor?.struct?.()?.atoms?.size === 1;
    },
    { timeout: 5_000 },
  );

  // Select atom 0
  await page.evaluate(() => {
    const editor = (
      window.ketcher as unknown as {
        editor?: { selection?: (sel: { atoms: number[]; bonds?: number[] }) => void };
      }
    ).editor;
    editor?.selection?.({ atoms: [0], bonds: [] });
  });
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { selection?: () => { atoms?: number[] } | null };
        }
      ).editor;
      const sel = editor?.selection?.();
      return sel?.atoms?.[0] === 0 && sel.atoms.length === 1;
    },
    { timeout: 3_000 },
  );

  await page.keyboard.press("3");
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => window.ketcher!.getSmiles());
  // Result should be toluene (CH3-C6H5) — a single connected component, not
  // "C.c1ccccc1" (which would mean disconnected fragments).
  expect(after.toLowerCase()).toContain("c1ccccc1");
  expect(after).not.toContain(".");
});

test("m re-labels the selected atom to Me", async ({ page }) => {
  await waitForKetcher(page);

  await page.evaluate(() => window.ketcher!.setMolecule("CC"));
  // Wait until Ketcher has actually rendered the structure (struct has atoms).
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { struct?: () => { atoms?: { size: number } } };
        }
      ).editor;
      const struct = editor?.struct?.();
      return struct?.atoms?.size === 2;
    },
    { timeout: 5_000 },
  );

  // Set selection and poll until it actually sticks — Ketcher's
  // editor.selection() setter races with the post-setMolecule render.
  await page.evaluate(() => {
    const editor = (
      window.ketcher as unknown as {
        editor?: { selection?: (sel: { atoms: number[]; bonds?: number[] }) => void };
      }
    ).editor;
    editor?.selection?.({ atoms: [0], bonds: [] });
  });
  await page.waitForFunction(
    () => {
      const editor = (
        window.ketcher as unknown as {
          editor?: { selection?: () => { atoms?: number[] } | null };
        }
      ).editor;
      const sel = editor?.selection?.();
      return sel?.atoms?.[0] === 0 && sel.atoms.length === 1;
    },
    { timeout: 3_000 },
  );

  await page.keyboard.press("m");

  // applyLabel does getMolfile + applyLabelToMolfile + setMolecule.
  // Ketcher's output format varies based on input — for inputs with trailing
  // newlines (which Ketcher's own getMolfile always emits) it converts to
  // CXSMILES like `CC |$Me;$|` rather than emitting a MOL with an A record.
  // Either encoding signals success — both contain the literal "Me" token.
  await page.waitForTimeout(2000);
  const mol = await page.evaluate(() => window.ketcher!.getMolfile());
  // "Me" appears in CXSMILES like `|$Me;$|` or in MOL A-record body.
  // Empty/un-labeled ethane has only "C" atoms, no "Me".
  expect(mol).toMatch(/\bMe\b/);
});
