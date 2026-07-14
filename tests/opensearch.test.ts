import { describe, expect, test } from "bun:test";
import { canonicalizePublicOrigin, opensearch } from "../src/opensearch";

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

  test("canonicalizes HTTP origins and removes non-origin components", () => {
    expect(
      canonicalizePublicOrigin(
        "https://Example.Test:443/nested/path?source=proxy#fragment"
      )
    ).toBe("https://example.test");
    expect(canonicalizePublicOrigin("http://example.test:8080/")).toBe(
      "http://example.test:8080"
    );
  });

  test("rejects non-HTTP origins and credentials", () => {
    expect(canonicalizePublicOrigin("ftp://example.test")).toBeNull();
    expect(canonicalizePublicOrigin("https://user@example.test")).toBeNull();
    expect(canonicalizePublicOrigin("not a URL")).toBeNull();
  });

  test("XML-escapes every dynamic origin insertion", async () => {
    const origin = `https://example.test/"'<>&`;
    const escapedOrigin = "https://example.test/&quot;&apos;&lt;&gt;&amp;";
    const xml = await opensearch(origin).text();

    expect(xml.split(escapedOrigin)).toHaveLength(4);
    expect(xml).not.toContain(origin);
  });
});
