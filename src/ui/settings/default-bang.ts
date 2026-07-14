import { flashAnim, shakeAnim } from "../animations";
import { loadBuiltinBangCatalog, searchBangs } from "../bang-catalog";
import type { DB } from "../db";
import { $, el } from "../dom";
import { notifySW } from "../sw-bridge";
import type { RunWrite } from "./write";

interface DefaultBangOptions {
  db: DB;
  initialBang: string;
  onCommit: (trigger: string) => void;
  runWrite: RunWrite;
}

export interface DefaultBangController {
  setCommitted: (trigger: string) => void;
}

export async function setupDefaultBangSetting({
  db,
  initialBang,
  onCommit,
  runWrite,
}: DefaultBangOptions): Promise<DefaultBangController> {
  const input = $<HTMLInputElement>("#default-bang");
  const results = $("#default-bang-results");
  const status = $("#bang-status");
  const catalog = await loadBuiltinBangCatalog();
  let committedBang = initialBang;
  let previewTimer: ReturnType<typeof setTimeout>;

  input.value = initialBang;
  status.textContent = catalog.byTrigger.get(initialBang)?.name || "Unknown";

  function closePreview(): void {
    results.classList.add("hidden");
    results.replaceChildren();
  }

  function setCommitted(trigger: string): void {
    const bang = catalog.byTrigger.get(trigger);
    committedBang = trigger;
    input.value = trigger;
    status.textContent = bang?.name || "Unknown";
    status.className = bang ? "text-sm text-success" : "text-sm text-danger";
  }

  input.addEventListener("input", () => {
    clearTimeout(previewTimer);
    const query = input.value.replace(/^!+/, "").trim().toLowerCase();
    if (!query) {
      closePreview();
      return;
    }
    previewTimer = setTimeout(() => {
      const hits = searchBangs(catalog.entries, query, 6);
      if (hits.length === 0) {
        results.replaceChildren(
          el(
            "div",
            "px-2.5 py-2 text-center text-xs text-text-secondary",
            "No matching bangs"
          )
        );
      } else {
        results.replaceChildren(
          ...hits.map(({ trigger, name, domain }) => {
            const row = el(
              "button",
              "flex w-full items-center gap-2 rounded-md border-none bg-transparent px-2 py-1.5 text-left text-text cursor-pointer hover:bg-bg-hover"
            );
            row.type = "button";
            row.dataset.trigger = trigger;
            row.setAttribute("role", "option");
            row.append(
              el(
                "code",
                "min-w-14 rounded bg-bg-active px-1.5 py-0.5 text-center font-mono text-xs",
                `!${trigger}`
              ),
              el("span", "min-w-0 flex-1 truncate text-xs font-medium", name),
              el(
                "span",
                "hidden max-w-28 truncate text-[10px] text-text-secondary sm:block",
                domain
              )
            );
            row.addEventListener("pointerdown", (event) => {
              event.preventDefault();
            });
            row.addEventListener("click", () => {
              input.value = trigger;
              closePreview();
              input.dispatchEvent(new Event("change"));
            });
            return row;
          })
        );
      }
      results.classList.remove("hidden");
    }, 120);
  });

  input.addEventListener("change", () => {
    closePreview();
    const value = input.value.replace(/^!+/, "").toLowerCase().trim();
    const bang = catalog.byTrigger.get(value);
    if (!bang) {
      shakeAnim(input);
      status.textContent = "Unknown bang";
      status.className = "text-sm text-danger";
      return;
    }
    void runWrite(() => db.setSetting("default-bang", value), {
      key: "default-bang",
      onCommit: () => {
        committedBang = value;
        notifySW("invalidate");
        onCommit(value);
        flashAnim(input);
        status.textContent = bang.name;
        status.className = "text-sm text-success";
      },
      onFailure: () => {
        input.value = committedBang;
        status.textContent =
          catalog.byTrigger.get(committedBang)?.name || "Unknown";
        status.className = "text-sm text-danger";
      },
    });
  });

  return { setCommitted };
}
