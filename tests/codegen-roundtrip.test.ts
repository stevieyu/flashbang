import { describe, expect, test } from "bun:test";
import { lookupBang } from "../src/generated/bangs-min.js";
import { hashFNV1a } from "../src/shared/hash";

const bangs: Array<{ trigger: string; url: string }> =
  await Bun.file("data/bangs.json").json();

describe("codegen round-trip", () => {
  test("every 100th bang resolves to a non-null entry", () => {
    const sample = bangs.filter((_, i) => i % 100 === 0);
    for (const bang of sample) {
      const result = lookupBang(bang.trigger, hashFNV1a(bang.trigger));
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
});
