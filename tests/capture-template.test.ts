import { describe, expect, test } from "bun:test";
import {
  compileCaptureUrl,
  parseCaptureTemplate,
  validateCaptureBang,
} from "../src/shared/capture-template";

describe("capture templates", () => {
  test("precompiles repeated and ordered placeholders", () => {
    expect(parseCaptureTemplate("https://example.com/$2/$1?q=$2")).toEqual([
      "https://example.com/",
      ["/", "?q=", ""],
      [2, 1, 2],
    ]);
  });

  test("compiles a safe capture template", () => {
    const compiled = compileCaptureUrl(
      "https://example.com/$1/$2",
      "(\\w+)\\s+(.*)",
      "percent"
    );
    expect(compiled?.[0]).toBe("https://example.com/");
    expect(compiled?.[2]).toEqual([1, 2]);
    expect(compiled?.[3].exec("en hello")?.slice(1)).toEqual(["en", "hello"]);
  });

  test("rejects missing and out-of-range captures", () => {
    expect(validateCaptureBang("https://example.com/{}", "(.*)")).toContain(
      "either"
    );
    expect(validateCaptureBang("https://example.com/$2", "(.*)")).toContain(
      "matching capture group"
    );
    expect(validateCaptureBang("https://$1.example.com/", "(.*)")).toContain(
      "origin"
    );
  });

  test("rejects unsafe regex constructs", () => {
    expect(validateCaptureBang("https://example.com/$1", "(a+)+$")).toContain(
      "Nested"
    );
    expect(validateCaptureBang("https://example.com/$1", "((a+))+$")).toContain(
      "Nested"
    );
    expect(validateCaptureBang("https://example.com/$1", "(a|aa)+$")).toContain(
      "ambiguous"
    );
    expect(validateCaptureBang("https://example.com/$1", "(a)\\1")).toContain(
      "Backreferences"
    );
    expect(
      validateCaptureBang("https://example.com/$1", "(?<value>a)\\k<value>")
    ).toContain("Backreferences");
  });
});
