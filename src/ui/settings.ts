import {
  DEFAULT_LUCKY_PROVIDER,
  LUCKY_TRIGGER_PROVIDERS,
  SUGGEST_TRIGGER_PROVIDERS,
} from "../shared/constants";
import { flashAnim, shakeAnim } from "./animations";
import { setSuggestCookie } from "./cookie";
import { setupCustomBangs } from "./custom-bangs";
import type { DB } from "./db";
import { $, el } from "./dom";
import { notifySW } from "./sw-bridge";

export async function initSettings(db: DB) {
  const defaultInput = $<HTMLInputElement>("#default-bang");
  const suggestSelect = $<HTMLSelectElement>("#suggest-provider");
  const suggestDefaultDisplay = $("#suggest-default-display");
  const suggestDefaultPrefix = $("#suggest-default-prefix");
  const suggestDefaultProvider = $("#suggest-default-provider");
  const suggestUrlInput = $<HTMLInputElement>("#suggest-url");
  const suggestFirefoxNote = $("#suggest-firefox-note");
  const suggestFirefoxProviderPickerWrap = $(
    "#suggest-firefox-provider-picker-wrap"
  );
  const suggestFirefoxProviderPicker = $<HTMLButtonElement>(
    "#suggest-firefox-provider-picker"
  );
  const suggestFirefoxProviderLabel = $("#suggest-firefox-provider-label");
  const suggestFirefoxUrl = $<HTMLButtonElement>("#suggest-firefox-url");
  const suggestFirefoxProviderMenu = $("#suggest-firefox-provider-menu");
  const luckySelect = $<HTMLSelectElement>("#lucky-provider");
  const luckyDefaultDisplay = $("#lucky-default-display");
  const luckyDefaultPrefix = $("#lucky-default-prefix");
  const luckyDefaultProvider = $("#lucky-default-provider");
  const luckyUrlInput = $<HTMLInputElement>("#lucky-url");

  const [rawSettings, initialCustom] = await Promise.all([
    db.getMultipleSettings([
      "default-bang",
      "suggest-provider",
      "suggest-url",
      "lucky-provider",
      "lucky-url",
    ]),
    db.getAllCustomBangs().then((all) => all.map((b) => b.trigger)),
  ]);
  const defaultBang = rawSettings[0] || "g";
  const savedProvider = rawSettings[1] || "default";
  const savedUrl = rawSettings[2] || "";
  const savedLucky = rawSettings[3] || "default";
  const savedLuckyUrl = rawSettings[4] || "";
  let activeDefaultBang = defaultBang;
  let custom = initialCustom;

  function setDefaultDisplay(
    select: HTMLSelectElement,
    display: HTMLElement,
    prefix: HTMLElement,
    providerBadge: HTMLElement,
    matchedProvider: string | undefined,
    fallbackProvider: string
  ) {
    const provider = matchedProvider || fallbackProvider;
    const providerOption = Array.from(select.options).find(
      (option) => option.value === provider
    );
    prefix.textContent = matchedProvider ? "Match bang" : "Fallback";
    providerBadge.textContent = providerOption?.text || provider;
    const visible = select.value === "default";
    display.classList.toggle("hidden", !visible);
    display.classList.toggle("flex", visible);
  }

  function updateDefaultDisplays(trigger: string) {
    setDefaultDisplay(
      luckySelect,
      luckyDefaultDisplay,
      luckyDefaultPrefix,
      luckyDefaultProvider,
      LUCKY_TRIGGER_PROVIDERS[trigger],
      DEFAULT_LUCKY_PROVIDER
    );
    setDefaultDisplay(
      suggestSelect,
      suggestDefaultDisplay,
      suggestDefaultPrefix,
      suggestDefaultProvider,
      SUGGEST_TRIGGER_PROVIDERS[trigger],
      "none"
    );
  }

  function syncCookie() {
    setSuggestCookie(
      suggestSelect.value,
      defaultInput.value.replace(/^!+/, "").toLowerCase().trim(),
      suggestUrlInput.value.trim(),
      custom
    );
  }

  luckySelect.value = savedLucky;
  if (savedLucky === "custom") {
    luckyUrlInput.classList.remove("hidden");
  }
  if (savedLuckyUrl) {
    luckyUrlInput.value = savedLuckyUrl;
  }

  defaultInput.value = defaultBang;
  if (savedUrl) {
    suggestUrlInput.value = savedUrl;
  }

  if (/Firefox\//.test(navigator.userAgent)) {
    let firefoxProvider = "google";
    let menuHideTimer: ReturnType<typeof setTimeout>;
    let providerMenuPinned = false;
    const firefoxSuggestionUrl = () =>
      `${location.origin}/suggest?q=%s&sp=${firefoxProvider}`;
    const showProviderMenu = () => {
      clearTimeout(menuHideTimer);
      suggestFirefoxProviderMenu.classList.remove("hidden");
      suggestFirefoxProviderPicker.setAttribute("aria-expanded", "true");
    };
    const hideProviderMenu = () => {
      suggestFirefoxProviderMenu.classList.add("hidden");
      suggestFirefoxProviderPicker.setAttribute("aria-expanded", "false");
    };
    const renderFirefoxSuggestionUrl = () => {
      const providerToken = el(
        "span",
        "rounded bg-success px-1 py-0.5 text-bg",
        firefoxProvider
      );
      suggestFirefoxProviderLabel.textContent = firefoxProvider;
      suggestFirefoxUrl.replaceChildren(
        `${location.origin}/suggest?q=%s&sp=`,
        providerToken
      );
      for (const option of suggestFirefoxProviderMenu.children) {
        const selected =
          (option as HTMLElement).dataset.provider === firefoxProvider;
        option.setAttribute("aria-selected", String(selected));
        option.classList.toggle("bg-bg-active", selected);
      }
    };

    const providerOptions = Array.from(suggestSelect.options).filter(
      (option) => !["default", "custom", "none"].includes(option.value)
    );
    suggestFirefoxProviderMenu.replaceChildren(
      ...providerOptions.map((provider) => {
        const option = el(
          "button",
          "block w-full rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-xs text-text cursor-pointer hover:bg-bg-hover",
          provider.text
        );
        option.type = "button";
        option.dataset.provider = provider.value;
        option.setAttribute("role", "option");
        option.addEventListener("click", () => {
          firefoxProvider = provider.value;
          providerMenuPinned = false;
          renderFirefoxSuggestionUrl();
          hideProviderMenu();
          suggestFirefoxProviderPicker.focus();
        });
        option.addEventListener("focus", showProviderMenu);
        return option;
      })
    );

    suggestSelect.value = "google";
    suggestSelect.disabled = true;
    suggestSelect.classList.add("select-locked");
    suggestUrlInput.disabled = true;
    suggestSelect.setAttribute("aria-describedby", "suggest-firefox-note");
    suggestFirefoxNote.classList.remove("hidden");
    renderFirefoxSuggestionUrl();
    suggestFirefoxProviderPickerWrap.addEventListener("pointerenter", () => {
      if (!providerMenuPinned) {
        showProviderMenu();
      }
    });
    suggestFirefoxProviderPickerWrap.addEventListener("pointerleave", () => {
      if (!providerMenuPinned) {
        menuHideTimer = setTimeout(hideProviderMenu, 150);
      }
    });
    suggestFirefoxProviderPicker.addEventListener("click", () => {
      if (providerMenuPinned) {
        providerMenuPinned = false;
        hideProviderMenu();
      } else {
        providerMenuPinned = true;
        showProviderMenu();
      }
    });
    suggestFirefoxProviderPicker.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        providerMenuPinned = true;
        showProviderMenu();
        (suggestFirefoxProviderMenu.firstElementChild as HTMLElement)?.focus();
      }
    });
    suggestFirefoxProviderMenu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        providerMenuPinned = false;
        hideProviderMenu();
        suggestFirefoxProviderPicker.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (
        providerMenuPinned &&
        event.target instanceof Node &&
        !suggestFirefoxProviderPickerWrap.contains(event.target)
      ) {
        providerMenuPinned = false;
        hideProviderMenu();
      }
    });
    suggestFirefoxUrl.addEventListener("click", async () => {
      const url = firefoxSuggestionUrl();
      hideProviderMenu();
      await navigator.clipboard.writeText(url);
      suggestFirefoxUrl.textContent = "Copied suggestion URL";
      flashAnim(suggestFirefoxUrl);
      setTimeout(() => {
        renderFirefoxSuggestionUrl();
      }, 1500);
    });
  } else {
    suggestSelect.value = savedProvider;
    if (savedProvider === "custom") {
      suggestUrlInput.classList.remove("hidden");
    }
  }

  updateDefaultDisplays(activeDefaultBang);
  syncCookie();

  const mod = await import("../generated/bangs-meta.js");
  const full: Record<string, { s: string; d: string }> = mod.BANGS;
  $("#bang-status").textContent = full[defaultBang]?.s || "Unknown";
  $("#bang-count").textContent =
    `${Object.keys(full).length.toLocaleString()} bangs available`;

  defaultInput.addEventListener("change", async () => {
    const val = defaultInput.value.replace(/^!+/, "").toLowerCase().trim();
    if (full[val]) {
      activeDefaultBang = val;
      await db.setSetting("default-bang", val);
      notifySW("invalidate");
      syncCookie();
      updateDefaultDisplays(activeDefaultBang);
      flashAnim(defaultInput);
      $("#bang-status").textContent = full[val].s;
      $("#bang-status").className = "text-sm text-success";
    } else {
      shakeAnim(defaultInput);
      $("#bang-status").textContent = "Unknown bang";
      $("#bang-status").className = "text-sm text-danger";
    }
  });

  suggestSelect.addEventListener("change", async () => {
    await db.setSetting("suggest-provider", suggestSelect.value);
    notifySW("invalidate");
    syncCookie();
    updateDefaultDisplays(activeDefaultBang);
    if (suggestSelect.value === "custom") {
      suggestUrlInput.classList.remove("hidden");
    } else {
      suggestUrlInput.classList.add("hidden");
    }
  });

  suggestUrlInput.addEventListener("change", async () => {
    await db.setSetting("suggest-url", suggestUrlInput.value.trim());
    notifySW("invalidate");
    syncCookie();
  });

  luckySelect.addEventListener("change", async () => {
    await db.setSetting("lucky-provider", luckySelect.value);
    notifySW("invalidate");
    updateDefaultDisplays(activeDefaultBang);
    if (luckySelect.value === "custom") {
      luckyUrlInput.classList.remove("hidden");
    } else {
      luckyUrlInput.classList.add("hidden");
    }
  });

  luckyUrlInput.addEventListener("change", async () => {
    await db.setSetting("lucky-url", luckyUrlInput.value.trim());
    notifySW("invalidate");
  });

  let timer: ReturnType<typeof setTimeout>;
  let cachedEntries: [string, { s: string; d: string }][] | null = null;
  $<HTMLInputElement>("#bang-search").addEventListener("input", (e) => {
    clearTimeout(timer);
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    if (!q) {
      $("#bang-results").replaceChildren();
      return;
    }
    timer = setTimeout(() => {
      if (!cachedEntries) {
        cachedEntries = Object.entries(full);
      }
      const hits = cachedEntries
        .filter(
          ([t, b]) =>
            t.includes(q) || b.s.toLowerCase().includes(q) || b.d.includes(q)
        )
        .sort((a, b) => {
          const as_ = a[0].startsWith(q) ? 0 : 1;
          const bs_ = b[0].startsWith(q) ? 0 : 1;
          return as_ - bs_ || a[0].length - b[0].length;
        })
        .slice(0, 20);
      const container = $("#bang-results");
      if (hits.length === 0) {
        container.replaceChildren(
          el(
            "div",
            "py-3 text-center text-sm text-text-secondary",
            "No matches"
          )
        );
      } else {
        container.replaceChildren(
          ...hits.map(([t, b]) => {
            const row = el(
              "div",
              "flex items-center gap-3 px-2.5 py-2 rounded-lg bg-bg-secondary mb-1"
            );
            row.append(
              el(
                "code",
                "px-1.5 py-0.5 rounded bg-bg-active text-xs min-w-15 text-center font-mono",
                `!${t}`
              ),
              el("span", "flex-1 text-[13px] font-medium", b.s),
              el(
                "span",
                "text-[11px] text-text-secondary max-w-30 overflow-hidden text-ellipsis whitespace-nowrap",
                b.d
              )
            );
            return row;
          })
        );
      }
    }, 200);
  });

  setupCustomBangs(db, (nextCustom) => {
    custom = nextCustom;
    syncCookie();
  });

  $("#export-btn").addEventListener("click", async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flashbang-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $<HTMLInputElement>("#import-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      await db.importAll(data);
      notifySW("invalidate");
      $("#import-status").textContent = "Imported successfully";
      $("#import-status").className = "text-sm mt-2 block text-success";
      setTimeout(() => location.reload(), 1000);
    } catch {
      $("#import-status").textContent = "Invalid file";
      $("#import-status").className = "text-sm mt-2 block text-danger";
    }
  });
}
