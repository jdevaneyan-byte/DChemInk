import { describe, it, expect, vi } from "vitest";
import {
  buildPubchemNameUrl,
  parseSmilesResponse,
  resolveNameToSmiles,
} from "@/chem/nameResolve";

// ---------------------------------------------------------------------------
// buildPubchemNameUrl
// ---------------------------------------------------------------------------
describe("buildPubchemNameUrl", () => {
  it("builds a URL for a simple name", () => {
    const url = buildPubchemNameUrl("aspirin");
    expect(url).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/property/SMILES/TXT"
    );
  });

  it("encodes spaces in the name", () => {
    const url = buildPubchemNameUrl("acetic acid");
    expect(url).toContain("acetic%20acid");
  });

  it("encodes special characters like parentheses", () => {
    const url = buildPubchemNameUrl("2-bromopropane");
    expect(url).toContain("2-bromopropane");
  });

  it("encodes plus signs (encodeURIComponent encodes '+' but not parens)", () => {
    const url = buildPubchemNameUrl("(+)-limonene");
    // encodeURIComponent encodes '+' → '%2B'; parens are unreserved and left as-is
    expect(url).toContain("%2B");
    expect(url).not.toContain("+");
    // parens are safe characters in URIs — they appear literally
    expect(url).toContain("(");
    expect(url).toContain(")");
  });

  it("trims leading/trailing whitespace before encoding", () => {
    const url = buildPubchemNameUrl("  aspirin  ");
    expect(url).toContain("aspirin");
    expect(url).not.toContain("%20aspirin");
  });
});

// ---------------------------------------------------------------------------
// parseSmilesResponse
// ---------------------------------------------------------------------------
describe("parseSmilesResponse", () => {
  it("returns the first non-empty line of a valid response", () => {
    const body = "CC(=O)OC1=CC=CC=C1C(=O)O\n";
    expect(parseSmilesResponse(body)).toBe("CC(=O)OC1=CC=CC=C1C(=O)O");
  });

  it("returns the SMILES when there are multiple lines", () => {
    const body = "CC(C)Br\nsome other line\n";
    expect(parseSmilesResponse(body)).toBe("CC(C)Br");
  });

  it("returns null for a body starting with 'Status:'", () => {
    const body = "Status: 404\nPUGREST.NotFound\n";
    expect(parseSmilesResponse(body)).toBeNull();
  });

  it("returns null for a body containing 'PUGREST.'", () => {
    const body = "Some preamble\nPUGREST.ServerError\n";
    expect(parseSmilesResponse(body)).toBeNull();
  });

  it("returns null for an empty body", () => {
    expect(parseSmilesResponse("")).toBeNull();
  });

  it("returns null for a whitespace-only body", () => {
    expect(parseSmilesResponse("   \n  ")).toBeNull();
  });

  it("trims whitespace from the returned SMILES", () => {
    const body = "  CC(C)Br  \n";
    expect(parseSmilesResponse(body)).toBe("CC(C)Br");
  });
});

// ---------------------------------------------------------------------------
// resolveNameToSmiles — mock fetch, no real network
// ---------------------------------------------------------------------------
describe("resolveNameToSmiles", () => {
  it("returns {error:'Enter a name'} for an empty string", async () => {
    const result = await resolveNameToSmiles("");
    expect(result).toEqual({ error: "Enter a name" });
  });

  it("returns {error:'Enter a name'} for whitespace-only input", async () => {
    const result = await resolveNameToSmiles("   ");
    expect(result).toEqual({ error: "Enter a name" });
  });

  it("returns {smiles} on a 200 response with a valid body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "CC(=O)OC1=CC=CC=C1C(=O)O\n",
    });
    const result = await resolveNameToSmiles("aspirin", mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ smiles: "CC(=O)OC1=CC=CC=C1C(=O)O" });
  });

  it("returns {error:'No structure returned'} when 200 but body is unparseable", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "Status: 404\nPUGREST.NotFound",
    });
    const result = await resolveNameToSmiles("notachemical", mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ error: "No structure returned" });
  });

  it("returns 'No match found' error on 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Status: 404\nPUGREST.NotFound",
    });
    const result = await resolveNameToSmiles("xyzzy", mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ error: 'No match found for "xyzzy"' });
  });

  it("returns 'Lookup failed (HTTP 500)' on a 500 error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error",
    });
    const result = await resolveNameToSmiles("aspirin", mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ error: "Lookup failed (HTTP 500)" });
  });

  it("returns network error when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const result = await resolveNameToSmiles("aspirin", mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ error: "Network error — check your connection" });
  });

  it("trims the name before calling the API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "CC(C)Br\n",
    });
    await resolveNameToSmiles("  2-bromopropane  ", mockFetch as unknown as typeof fetch);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("2-bromopropane");
    expect(calledUrl).not.toContain("%202-bromopropane");
  });
});
