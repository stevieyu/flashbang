import { describe, expect, test } from "bun:test";
import {
  lookupAdvancedBang,
  lookupBang,
  lookupSnapOverride,
} from "../src/generated/bangs-min.js";
import { hashFNV1a } from "../src/shared/hash";

const bangs: Array<{ trigger: string; url: string }> =
  await Bun.file("data/bangs.json").json();

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
