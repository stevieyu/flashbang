import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDB } from "../src/shared/idb";
import { DB } from "../src/ui/db";
import { installFakeIndexedDb } from "./helpers/fake-indexeddb";

let restoreIndexedDb: (() => void) | null = null;

beforeEach(() => {
  restoreIndexedDb = installFakeIndexedDb();
  resetDB();
});

afterEach(() => {
  resetDB();
  restoreIndexedDb?.();
  restoreIndexedDb = null;
});

describe("custom bang import and export", () => {
  test("atomically renames an existing custom bang", async () => {
    const db = new DB();
    await db.addCustomBang({
      trigger: "old",
      name: "Old",
      url: "https://example.com/old?q={}",
    });

    await db.updateCustomBang("old", {
      trigger: "new",
      name: "New",
      url: "https://example.com/new?q={}",
    });

    expect(await db.getAllCustomBangs()).toEqual([
      {
        trigger: "new",
        name: "New",
        url: "https://example.com/new?q={}",
      },
    ]);
  });

  test("round-trips capture pattern and encoding", async () => {
    const db = new DB();
    await db.importAll({
      customBangs: [
        {
          trigger: "trurl",
          name: "Translate URL",
          url: "https://example.com/$1/$2",
          regex: "(\\w+)\\s+(.*)",
          encoding: "plus",
          snap: "translate.example/docs",
        },
      ],
    });

    expect(await db.getAllCustomBangs()).toEqual([
      {
        trigger: "trurl",
        name: "Translate URL",
        url: "https://example.com/$1/$2",
        regex: "(\\w+)\\s+(.*)",
        encoding: "plus",
        snap: "translate.example/docs",
      },
    ]);
    const exported = await db.exportAll();
    expect(exported.customBangs[0].regex).toBe("(\\w+)\\s+(.*)");
    expect(exported.customBangs[0].encoding).toBe("plus");
    expect(exported.customBangs[0].snap).toBe("translate.example/docs");
  });

  test("drops unsafe imported patterns", async () => {
    const db = new DB();
    await db.importAll({
      customBangs: [
        {
          trigger: "unsafe",
          name: "Unsafe",
          url: "https://example.com/$1",
          regex: "(a+)+$",
        },
      ],
    });
    expect(await db.getAllCustomBangs()).toEqual([]);
  });

  test("drops invalid imported snap targets", async () => {
    const db = new DB();
    await db.importAll({
      customBangs: [
        {
          trigger: "unsafe-snap",
          name: "Unsafe Snap",
          url: "https://example.com?q={}",
          snap: "javascript://example.com",
        },
      ],
    });
    expect(await db.getAllCustomBangs()).toEqual([]);
  });

  test("drops imported bangs with invalid triggers", async () => {
    const db = new DB();
    const invalidTriggers = [
      "",
      "two words",
      "foo!bar",
      "foo@bar",
      "foo+bar",
      "foo%20bar",
      "foo%21bar",
      "foo%40bar",
      "a".repeat(65),
      "settings",
    ];
    await db.importAll({
      customBangs: [
        ...invalidTriggers.map((trigger) => ({
          trigger,
          name: "Invalid",
          url: "https://example.com?q={}",
        })),
        {
          trigger: "valid",
          name: "Valid",
          url: "https://example.com?q={}",
        },
      ],
    });

    expect(await db.getAllCustomBangs()).toEqual([
      {
        trigger: "valid",
        name: "Valid",
        url: "https://example.com?q={}",
      },
    ]);
  });
});
