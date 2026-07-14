import { describe, expect, test } from "bun:test";
import {
  lookupAdvancedBang,
  lookupBang,
  lookupSnapOverride,
} from "../src/generated/bangs-min.js";
import { hashFNV1a } from "../src/shared/hash";

const bangs: Array<{ trigger: string; url: string }> =
  await Bun.file("data/bangs.json").json();
const generatedSource = await Bun.file("src/generated/bangs-min.js").text();

describe("codegen round-trip", () => {
  test("every 100th bang resolves to a non-null entry", () => {
    const sample = bangs.filter((_, i) => i % 100 === 0);
    for (const bang of sample) {
      const result =
        lookupBang(bang.trigger, hashFNV1a(bang.trigger)) ??
        lookupAdvancedBang(bang.trigger);
      expect(result).not.toBeNull();
    }
  });

  test("common bangs resolve correctly", () => {
    const common = ["g", "w", "yt", "gh", "mdn", "npm"];
    for (const trigger of common) {
      const result = lookupBang(trigger, hashFNV1a(trigger));
      expect(result).not.toBeNull();
      expect(result![0]).toContain("://");
    }
  });

  test("materializes and caches URL tuples on demand", () => {
    const hash = hashFNV1a("g");
    const first = lookupBang("g", hash);
    expect(first).not.toBeNull();
    expect(lookupBang("g", hash)).toBe(first);
  });

  test("keeps triggers and URL parts packed during initialization", () => {
    expect(generatedSource).not.toContain("const _TS=");
    expect(generatedSource).not.toContain("_TC[_i]=");
    expect(generatedSource).toContain("_TB.startsWith(trigger,_TO[idx])");
    expect(generatedSource).toContain("function _tuple(idx)");
  });

  test("regex bangs are emitted only through the sparse advanced lookup", () => {
    expect(lookupBang("ktr", hashFNV1a("ktr"))).toBeNull();
    const advanced = lookupAdvancedBang("ktr");
    expect(advanced?.[0]).toBe("https://translate.kagi.com/");
    expect(advanced?.[2]).toEqual([1, 2]);
    expect(advanced?.[3].source).toBe("(\\w+)\\s+(.*)");
  });

  test("Kagi ad values are emitted through the hashed snap lookup", () => {
    expect(lookupSnapOverride("g", hashFNV1a("g"), false)).toBeNull();
    expect(lookupSnapOverride("hn", hashFNV1a("hn"), false)).toBe(
      "+site:news.ycombinator.com"
    );
    expect(lookupSnapOverride("hn", hashFNV1a("hn"), true)).toBe(
      "https://news.ycombinator.com"
    );
    expect(lookupSnapOverride("nr", hashFNV1a("nr"), false)).toBe(
      "+site:github.com/NixOS/nixpkgs"
    );
  });
});
