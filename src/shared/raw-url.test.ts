import { describe, expect, test } from "bun:test";
import { readOrigin, readPathname } from "./raw-url";

describe("readPathname", () => {
  test("parses pathname from absolute URL with query and hash", () => {
    expect(
      readPathname("https://flashbang.local/suggest?q=cats&sp=none#frag")
    ).toBe("/suggest");
  });

  test("returns / for origin-only absolute URL", () => {
    expect(readPathname("https://flashbang.local")).toBe("/");
    expect(readPathname("https://flashbang.local?q=1")).toBe("/");
  });

  test("parses pathname from path-only URL", () => {
    expect(readPathname("/bench?x=1")).toBe("/bench");
    expect(readPathname("/")).toBe("/");
  });

  test("returns / for invalid relative URL without leading slash", () => {
    expect(readPathname("suggest?q=cats")).toBe("/");
  });

  test("treats empty pathname as /", () => {
    expect(readPathname("https://flashbang.local#top")).toBe("/");
  });
});

describe("readOrigin", () => {
  test("returns origin for absolute URLs with and without paths", () => {
    expect(readOrigin("https://flashbang.local/suggest?q=1")).toBe(
      "https://flashbang.local"
    );
    expect(readOrigin("https://flashbang.local")).toBe(
      "https://flashbang.local"
    );
    expect(readOrigin("http://localhost:3000/path")).toBe(
      "http://localhost:3000"
    );
  });

  test("returns empty string for path-only URLs", () => {
    expect(readOrigin("/suggest?q=1")).toBe("");
  });
});
