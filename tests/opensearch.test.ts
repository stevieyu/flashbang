import { describe, expect, test } from "bun:test";
import { opensearch } from "../src/opensearch";

describe("opensearch", () => {
  test("returns XML with expected content-type", async () => {
    const response = opensearch("https://flashbang.local");
    expect(response.headers.get("Content-Type")).toBe(
      "application/opensearchdescription+xml"
    );
    const xml = await response.text();
    expect(xml).toContain("<OpenSearchDescription");
  });

  test("uses the provided origin for all URL templates", async () => {
    const origin = "https://example.test:8443";
    const xml = await opensearch(origin).text();
    expect(xml).toContain(`${origin}/icon.svg`);
    expect(xml).toContain(`${origin}/?q={searchTerms}`);
    expect(xml).toContain(`${origin}/suggest?q={searchTerms}`);
  });
});
