import { describe, expect, test } from "bun:test";
import {
  parseFrecencyCompact,
  serializeFrecencyCompact,
} from "../src/shared/frecency-serial";

describe("frecency compact serialization", () => {
  test("serializes null as empty string", () => {
    expect(serializeFrecencyCompact(null)).toBe("");
  });

  test("round-trips compact key/count pairs", () => {
    const serialized = serializeFrecencyCompact({ g: 10, ddg: 3 });
    const parsed = parseFrecencyCompact(serialized);
    expect(parsed).toEqual({ g: 10, ddg: 3 });
  });

  test("ignores malformed and non-positive entries during parse", () => {
    expect(parseFrecencyCompact("g:0,ddg:-1,yt:abc,w:4,broken")).toEqual({
      w: 4,
    });
  });
});
