import {
  type BangMeta,
  createBangMeta,
  loadBuiltinBangCatalog,
  searchBangs,
} from "../bang-catalog";
import type { DB } from "../db";
import { $, el } from "../dom";

function customDomain(url: string): string {
  try {
    return new URL(url.replace("{}", "query")).hostname || "custom";
  } catch {
    return "custom";
  }
}

export function setupBangCommand(db: DB): HTMLInputElement {
  const form = $<HTMLFormElement>("#bang-command-form");
  const input = $<HTMLInputElement>("#bang-command-input");
  const results = $("#bang-command-results");
  const count = $("#home-bang-count");
  let entries: readonly BangMeta[] | null = null;
  let loading: Promise<void> | null = null;
  let visible: BangMeta[] = [];
  let optionElements: HTMLButtonElement[] = [];
  let selectedCommand: { marker: "!" | "@"; trigger: string } | null = null;
  let selected = -1;

  function closeResults(): void {
    results.classList.add("hidden");
    results.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    visible = [];
    optionElements = [];
    selected = -1;
  }

  function commandParts(): { marker: "!" | "@"; search: string } | null {
    const value = input.value.trimStart();
    const marker = value.charAt(0);
    if (marker !== "!" && marker !== "@") {
      const search = value.toLowerCase().trim();
      return /\s/.test(search) ? null : { marker: "!", search };
    }
    const rest = value.substring(1);
    if (/\s/.test(rest)) {
      return null;
    }
    return { marker, search: rest.toLowerCase().trim() };
  }

  function renderSelection(previous = -1, scroll = true): void {
    const previousOption = optionElements[previous];
    if (previousOption) {
      previousOption.classList.remove("command-result-active");
      previousOption.setAttribute("aria-selected", "false");
    }
    const option = optionElements[selected];
    if (option) {
      option.classList.add("command-result-active");
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", option.id);
      if (scroll) {
        option.scrollIntoView({ block: "nearest" });
      }
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function setSelection(next: number): void {
    if (next === selected) {
      return;
    }
    const previous = selected;
    selected = next;
    renderSelection(previous);
  }

  function select(entry: BangMeta, marker: "!" | "@"): void {
    selectedCommand = { marker, trigger: entry.trigger };
    input.value = `${entry.trigger} `;
    closeResults();
    input.focus();
  }

  function hasSelectedCommand(value: string): boolean {
    if (!selectedCommand) {
      return false;
    }
    return (
      value === selectedCommand.trigger ||
      value.startsWith(`${selectedCommand.trigger} `)
    );
  }

  function renderResults(): void {
    if (!entries) {
      return;
    }
    const parts = commandParts();
    if (!parts?.search) {
      closeResults();
      return;
    }
    visible = searchBangs(entries, parts.search, 7);
    selected = visible.length > 0 ? 0 : -1;
    optionElements = [];

    if (visible.length === 0) {
      results.replaceChildren(
        el(
          "div",
          "px-4 py-4 text-center text-sm text-text-secondary",
          `No bang found for "${parts.search}"`
        )
      );
    } else {
      optionElements = visible.map((entry, index) => {
        const row = el(
          "button",
          "command-result flex w-full items-center gap-3 border-none px-2.5 py-2 text-left text-text cursor-pointer"
        );
        row.id = `bang-command-option-${index}`;
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === selected));
        row.append(
          el(
            "code",
            "command-badge min-w-16 rounded-md px-2 py-0.5 text-center font-mono text-xs font-semibold",
            `${parts.marker}${entry.trigger}`
          ),
          el("span", "min-w-0 flex-1 truncate text-sm font-medium", entry.name),
          el(
            "span",
            "hidden max-w-36 truncate text-xs text-text-secondary sm:block",
            entry.domain
          )
        );
        row.addEventListener("pointerenter", () => {
          setSelection(index);
        });
        row.addEventListener("click", () => select(entry, parts.marker));
        return row;
      });
      results.replaceChildren(...optionElements);
    }
    results.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    renderSelection(-1, false);
  }

  function loadEntries(): Promise<void> {
    if (entries) {
      return Promise.resolve();
    }
    if (loading) {
      return loading;
    }
    loading = Promise.all([
      loadBuiltinBangCatalog(),
      db.getAllCustomBangs().catch(() => []),
    ])
      .then(([catalog, custom]) => {
        if (custom.length === 0) {
          entries = catalog.entries;
        } else {
          const overrides = new Map(
            custom.map((bang) => [
              bang.trigger,
              createBangMeta(bang.trigger, bang.name, customDomain(bang.url)),
            ])
          );
          const merged = catalog.entries.map((entry) => {
            const override = overrides.get(entry.trigger);
            if (override) {
              overrides.delete(entry.trigger);
              return override;
            }
            return entry;
          });
          merged.push(...overrides.values());
          entries = merged;
        }
        count.textContent = `${entries.length.toLocaleString()} shortcuts`;
      })
      .catch(() => {
        entries = [];
        count.textContent = "Bang index unavailable";
      })
      .finally(() => {
        loading = null;
        renderResults();
      });
    return loading;
  }

  input.addEventListener("focus", () => void loadEntries());
  form.addEventListener("pointerenter", () => void loadEntries(), {
    once: true,
  });
  input.addEventListener("input", () => {
    if (selectedCommand) {
      if (hasSelectedCommand(input.value.trimStart())) {
        closeResults();
        return;
      }
      selectedCommand = null;
    }
    if (entries) {
      renderResults();
    } else {
      void loadEntries();
    }
  });
  input.addEventListener("keydown", (event) => {
    const vimKey = event.ctrlKey ? event.key.toLowerCase() : "";
    const next =
      event.key === "ArrowDown" ||
      vimKey === "j" ||
      (event.key === "Tab" && !event.shiftKey);
    const previous =
      event.key === "ArrowUp" ||
      vimKey === "k" ||
      (event.key === "Tab" && event.shiftKey);
    if (next && visible.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setSelection((selected + 1) % visible.length);
    } else if (previous && visible.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setSelection((selected - 1 + visible.length) % visible.length);
    } else if (event.key === "Escape") {
      closeResults();
    } else if (
      (event.key === "Enter" || vimKey === "y") &&
      selected >= 0 &&
      visible[selected]
    ) {
      const parts = commandParts();
      if (parts) {
        event.preventDefault();
        event.stopPropagation();
        select(visible[selected], parts.marker);
      }
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let query = input.value.trim();
    if (selectedCommand && hasSelectedCommand(query)) {
      query = `${selectedCommand.marker}${query}`;
    }
    if (query) {
      location.assign(`/?q=${encodeURIComponent(query)}`);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !form.contains(event.target)) {
      closeResults();
    }
  });
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => void loadEntries(), { timeout: 1500 });
  } else {
    setTimeout(() => void loadEntries(), 800);
  }
  return input;
}
