import { describe, expect, test } from "bun:test";

import type { UrlParts } from "../src/sw/redirect";
import { type RedirectSettings, redirectRaw } from "../src/sw/redirect";

const DEFAULT_URL: UrlParts = ["https://www.google.com/search?q=", ""];
const LUCKY_URL: UrlParts = ["https://www.google.com/search?btnI&q=", ""];

function settings(): RedirectSettings {
  return {
    defaultUrl: DEFAULT_URL,
    custom: {
      g: ["https://www.google.com/search?q=", ""],
      tw: ["https://twitter.com/", ""],
    },
    luckyUrl: LUCKY_URL,
  };
}

const WARMUP = 10_000;
const ITERS = 100_000;

function benchRedirectRaw(raw: string): number {
  const s = settings();
  for (let i = 0; i < WARMUP; i++) {
    redirectRaw(raw, s);
  }
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) {
    redirectRaw(raw, s);
  }
  return (performance.now() - t0) / ITERS;
}

describe("redirect performance regression", () => {
  test("prefix bang redirect stays under 0.005ms", () => {
    const ms = benchRedirectRaw("!g+kittens+are+cute");
    expect(ms).toBeLessThan(0.005);
  });

  test("long query redirect stays under 0.01ms", () => {
    const ms = benchRedirectRaw(`!g+${"a+".repeat(50)}b`);
    expect(ms).toBeLessThan(0.01);
  });

  test("path-based bang redirect stays under 0.005ms", () => {
    const ms = benchRedirectRaw("!tw+hello+world");
    expect(ms).toBeLessThan(0.005);
  });

  test("prefix snap redirect stays under 0.005ms", () => {
    const ms = benchRedirectRaw("@g+kittens");
    expect(ms).toBeLessThan(0.005);
  });

  test("suffix snap redirect stays under 0.005ms", () => {
    const ms = benchRedirectRaw("kittens+@g");
    expect(ms).toBeLessThan(0.005);
  });
});
