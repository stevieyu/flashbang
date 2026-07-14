import type { DB } from "../db";
import { $ } from "../dom";
import type { RunWrite } from "./write";

interface SettingsTransferOptions {
  db: DB;
  exportButton: HTMLButtonElement;
  importFile: HTMLInputElement;
  onImported: () => Promise<void>;
  runWrite: RunWrite;
}

export function setupSettingsTransfer({
  db,
  exportButton,
  importFile,
  onImported,
  runWrite,
}: SettingsTransferOptions): void {
  const status = $("#import-status");

  exportButton.addEventListener("click", async () => {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `flashbang-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      status.textContent = "Exported settings successfully";
      status.className = "text-sm mt-2 block text-success";
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? `Export failed: ${error.message}`
          : "Export failed";
      status.className = "text-sm mt-2 block text-danger";
    }
  });

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const preview = await db.importAll(data, () => false);
      const summary = `${preview.importedSettings} settings, ${preview.acceptedCustomBangs} custom bangs accepted, ${preview.rejectedCustomBangs} rejected`;
      status.textContent = `Ready to replace: ${summary}`;
      status.className = "text-sm mt-2 block text-text-secondary";
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      if (!window.confirm(`Replace current settings?\n\n${summary}`)) {
        status.textContent = `Import canceled: ${summary}`;
        return;
      }
      let result = preview;
      const committed = await runWrite(
        async () => {
          result = await db.importAll(data);
        },
        { key: "import" }
      );
      if (!committed) {
        throw new Error("Import failed");
      }
      await onImported();
      status.textContent = `Imported: ${result.importedSettings} settings, ${result.acceptedCustomBangs} custom bangs accepted, ${result.rejectedCustomBangs} rejected`;
      status.className =
        result.rejectedCustomBangs > 0
          ? "text-sm mt-2 block text-danger"
          : "text-sm mt-2 block text-success";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Invalid file";
      status.className = "text-sm mt-2 block text-danger";
    } finally {
      importFile.value = "";
    }
  });
}
