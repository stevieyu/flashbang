import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { posix } from "node:path";

const TREE_LINE = /^((?:(?:│ {3}| {4}))*)(?:├──|└──) (.+)$/u;

describe("DEVELOPMENT.md project structure", () => {
  test("documents every tracked file with the correct type", async () => {
    const markdown = await Bun.file("DEVELOPMENT.md").text();
    const block = markdown.match(
      /## Project structure\s+```(?:text)?\n([\s\S]*?)\n```/
    )?.[1];
    expect(block).toBeDefined();

    const lines = block!.split("\n");
    expect(lines.shift()).toBe("flashbang/");

    const directories: string[] = [];
    const documented = new Set<string>();
    const documentedFiles = new Set<string>();

    for (const line of lines) {
      const match = line.match(TREE_LINE);
      expect(match, `Malformed project tree line: ${line}`).not.toBeNull();

      const depth = match![1].length / 4;
      expect(Number.isInteger(depth), `Invalid indentation: ${line}`).toBe(
        true
      );
      expect(depth).toBeLessThanOrEqual(directories.length);

      const entry = match![2].replace(/\s+#.*$/, "").trim();
      const isDirectory = entry.endsWith("/");
      const name = isDirectory ? entry.slice(0, -1) : entry;
      const path = posix.join(...directories.slice(0, depth), name);

      expect(documented.has(path), `Duplicate documented path: ${path}`).toBe(
        false
      );
      documented.add(path);

      if (name.includes("*")) {
        const matches = [...new Bun.Glob(path).scanSync(".")];
        expect(
          matches.length,
          `No files match documented path: ${path}`
        ).toBeGreaterThan(0);
        for (const file of matches) {
          documentedFiles.add(file);
        }
      } else {
        const info = await stat(path).catch(() => null);
        expect(info, `Documented path does not exist: ${path}`).not.toBeNull();
        expect(
          isDirectory ? info!.isDirectory() : info!.isFile(),
          `Documented path has the wrong type: ${path}`
        ).toBe(true);
        if (!isDirectory) {
          documentedFiles.add(path);
        }
      }

      if (isDirectory) {
        directories[depth] = name;
        directories.length = depth + 1;
      }
    }

    const git = Bun.spawn(["git", "ls-files", "-z"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [trackedOutput, gitError, exitCode] = await Promise.all([
      new Response(git.stdout).text(),
      new Response(git.stderr).text(),
      git.exited,
    ]);
    expect(exitCode, gitError).toBe(0);

    const undocumented: string[] = [];
    for (const path of trackedOutput.split("\0")) {
      if (!path) {
        continue;
      }
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && !documentedFiles.has(path)) {
        undocumented.push(path);
      }
    }
    expect(undocumented, "Tracked files missing from the project tree").toEqual(
      []
    );
  });
});
