import { describe, expect, test } from "bun:test";
import { resolveTemplateParts } from "../src/shared/template";

describe("resolveTemplateParts", () => {
  test("returns null when placeholder is missing", () => {
    expect(resolveTemplateParts("https://example.com/search?q=")).toBeNull();
  });

  test("splits around first placeholder", () => {
    expect(resolveTemplateParts("https://example.com/?q={}&x=1")).toEqual([
      "https://example.com/?q=",
      "&x=1",
    ]);
  });

  test("returns stable cached result for same input", () => {
    const url = "https://example.com/?q={}";
    const first = resolveTemplateParts(url);
    const second = resolveTemplateParts(url);
    expect(first).toEqual(["https://example.com/?q=", ""]);
    expect(first).toBe(second);
  });
});
