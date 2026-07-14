import type { DB } from "./db";
import { $, el } from "./dom";

interface BangMeta {
  domain: string;
  domainLower: string;
  name: string;
  nameLower: string;
  trigger: string;
}

function customDomain(url: string): string {
  try {
    return new URL(url.replace("{}", "query")).hostname || "custom";
  } catch {
    return "custom";
  }
}

async function copyInput(input: HTMLInputElement): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(input.value);
    return;
  }
  input.select();
  document.execCommand("copy");
  input.setSelectionRange(0, 0);
}

function setupAddressBarSheet(): void {
  const modal = $("#setup-modal");
  const card = $("#setup-card");
  const openButton = $<HTMLButtonElement>("#open-setup");
  const closeButton = $<HTMLButtonElement>("#setup-close");
  const status = $("#setup-copy-status");
  const searchUrl = $<HTMLInputElement>("#setup-search-url");
  const suggestUrl = $<HTMLInputElement>("#setup-suggest-url");

  searchUrl.value = `${location.origin}?q=%s`;
  suggestUrl.value = `${location.origin}/suggest?q=%s`;

  function open(): void {
    modal.classList.replace("opacity-0", "opacity-100");
    modal.classList.replace("invisible", "visible");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    card.classList.replace("translate-y-4", "translate-y-0");
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function close(): void {
    modal.classList.replace("opacity-100", "opacity-0");
    modal.classList.replace("visible", "invisible");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    card.classList.replace("translate-y-0", "translate-y-4");
    document.body.style.overflow = "";
    openButton.focus();
  }

  async function copy(
    input: HTMLInputElement,
    button: HTMLButtonElement
  ): Promise<void> {
    const label = button.querySelector<HTMLElement>("[data-copy-label]")!;
    try {
      await copyInput(input);
      label.textContent = "Copied";
      button.classList.add("copied");
      status.textContent = `${button.dataset.label} copied`;
      window.setTimeout(() => {
        label.textContent = "Copy";
        button.classList.remove("copied");
      }, 1400);
    } catch {
      status.textContent = "Could not copy URL";
      input.focus();
      input.select();
    }
  }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("open")) {
      close();
    }
  });

  for (const [buttonId, input] of [
    ["#copy-search-url", searchUrl],
    ["#copy-suggest-url", suggestUrl],
  ] as const) {
    const button = $<HTMLButtonElement>(buttonId);
    button.addEventListener("click", () => void copy(input, button));
    input.addEventListener("click", () => input.select());
  }

  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = card.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function setupBangCommand(db: DB): void {
  const form = $<HTMLFormElement>("#bang-command-form");
  const input = $<HTMLInputElement>("#bang-command-input");
  const results = $("#bang-command-results");
  const count = $("#home-bang-count");
  let entries: BangMeta[] | null = null;
  let loading: Promise<void> | null = null;
  let visible: BangMeta[] = [];
  let optionElements: HTMLButtonElement[] = [];
  let candidateQuery = "";
  let candidates: BangMeta[] = [];
  let selectedCommand: { marker: "!" | "@"; trigger: string } | null = null;
  let selected = -1;

  function closeResults(): void {
    results.classList.add("hidden");
    results.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    visible = [];
    optionElements = [];
    candidateQuery = "";
    candidates = [];
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

  function score(entry: BangMeta, query: string): number {
    if (entry.trigger === query) {
      return 0;
    }
    if (entry.trigger.startsWith(query)) {
      return 1;
    }
    if (entry.nameLower.startsWith(query)) {
      return 2;
    }
    if (entry.domainLower.startsWith(query)) {
      return 3;
    }
    if (entry.trigger.includes(query)) {
      return 4;
    }
    if (entry.nameLower.includes(query)) {
      return 5;
    }
    if (entry.domainLower.includes(query)) {
      return 6;
    }
    return 99;
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

  function findBest(query: string): BangMeta[] {
    const source =
      candidateQuery && query.startsWith(candidateQuery)
        ? candidates
        : entries!;
    const nextCandidates: BangMeta[] = [];
    const best: Array<{ entry: BangMeta; score: number }> = [];

    for (const entry of source) {
      const entryScore = score(entry, query);
      if (entryScore === 99) {
        continue;
      }
      nextCandidates.push(entry);
      let position = 0;
      while (position < best.length) {
        const current = best[position];
        const triggerOrder =
          entry.trigger < current.entry.trigger
            ? -1
            : Number(entry.trigger > current.entry.trigger);
        const order =
          entryScore - current.score ||
          entry.trigger.length - current.entry.trigger.length ||
          triggerOrder;
        if (order < 0) {
          break;
        }
        position++;
      }
      if (position < 7) {
        best.splice(position, 0, { entry, score: entryScore });
        if (best.length > 7) {
          best.pop();
        }
      }
    }

    candidateQuery = query;
    candidates = nextCandidates;
    return best.map((item) => item.entry);
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
    visible = findBest(parts.search);
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
      import("../generated/bangs-meta.js"),
      db.getAllCustomBangs(),
    ])
      .then(([module, custom]) => {
        const merged = new Map<string, BangMeta>();
        const builtIn: Record<string, { d: string; s: string }> = module.BANGS;
        for (const [trigger, bang] of Object.entries(builtIn)) {
          merged.set(trigger, {
            trigger,
            name: bang.s,
            nameLower: bang.s.toLowerCase(),
            domain: bang.d,
            domainLower: bang.d.toLowerCase(),
          });
        }
        for (const bang of custom) {
          const domain = customDomain(bang.url);
          merged.set(bang.trigger, {
            trigger: bang.trigger,
            name: bang.name,
            nameLower: bang.name.toLowerCase(),
            domain,
            domainLower: domain.toLowerCase(),
          });
        }
        entries = [...merged.values()];
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
  let awaitingInputKey = false;
  let inputKeyTimer = 0;
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    const key = event.key.toLowerCase();
    const unmodified = !(event.altKey || event.ctrlKey || event.metaKey);
    if (!typing && awaitingInputKey && unmodified && key === "i") {
      event.preventDefault();
      window.clearTimeout(inputKeyTimer);
      awaitingInputKey = false;
      input.focus();
      return;
    }
    awaitingInputKey = false;
    window.clearTimeout(inputKeyTimer);
    if (!typing && unmodified && key === "g" && !event.repeat) {
      awaitingInputKey = true;
      inputKeyTimer = window.setTimeout(() => {
        awaitingInputKey = false;
      }, 700);
      return;
    }
    if (
      (!typing && event.key === "/") ||
      ((event.metaKey || event.ctrlKey) && key === "k")
    ) {
      event.preventDefault();
      input.focus();
    }
  });
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => void loadEntries(), { timeout: 1500 });
  } else {
    setTimeout(() => void loadEntries(), 800);
  }
}

export function initHome(db: DB): void {
  setupBangCommand(db);
  setupAddressBarSheet();
}
