import { validateSimpleBangUrl } from "../shared/capture-template";
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
  const saveStatus = $("#settings-save-status");
  const savedIcon = $("#settings-saved-icon");
  const savingIcon = $("#settings-saving-icon");
  const errorIcon = $("#settings-error-icon");
  const importFile = $<HTMLInputElement>("#import-file");
  const exportButton = $<HTMLButtonElement>("#export-btn");

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
  let committedDefaultBang = defaultBang;
  let committedSuggestProvider = savedProvider;
  let committedSuggestUrl = savedUrl;
  let committedLuckyProvider = savedLucky;
  let committedLuckyUrl = savedLuckyUrl;
  let pendingSuggestCustom = false;
  let pendingLuckyCustom = false;

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
      committedSuggestProvider,
      committedDefaultBang,
      committedSuggestUrl,
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

  const isFirefox = /Firefox\//.test(navigator.userAgent);
  if (isFirefox) {
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
    committedSuggestProvider = "google";
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

  const customFormControls = Array.from(
    $<HTMLFormElement>("#add-bang-form").elements
  ).filter(
    (
      control
    ): control is HTMLInputElement | HTMLSelectElement | HTMLButtonElement =>
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLButtonElement
  );
  const settingControls = [
    defaultInput,
    suggestSelect,
    suggestUrlInput,
    luckySelect,
    luckyUrlInput,
    importFile,
    exportButton,
    ...customFormControls,
  ];
  const permanentlyDisabled = new Set(
    settingControls.filter((control) => control.disabled)
  );
  let pendingWrites = 0;
  let completedWrites = 0;
  const failedWrites = new Set<string>();
  const validationErrors = new Map<string, string>();
  let writeChain: Promise<void> = Promise.resolve();

  function renderWriteState(): void {
    saveStatus.dataset.pending = String(pendingWrites);
    saveStatus.dataset.writeCount = String(completedWrites);
    if (pendingWrites > 0) {
      saveStatus.dataset.state = "saving";
      saveStatus.setAttribute("aria-label", "Saving settings");
      saveStatus.removeAttribute("title");
      savedIcon.classList.add("hidden");
      savingIcon.classList.remove("hidden");
      errorIcon.classList.add("hidden");
    } else if (validationErrors.size > 0 || failedWrites.size > 0) {
      const message =
        validationErrors.values().next().value || "Could not save settings";
      saveStatus.dataset.state = "error";
      saveStatus.dataset.failed = [...failedWrites].join(",");
      saveStatus.setAttribute("aria-label", message);
      saveStatus.setAttribute("title", message);
      savedIcon.classList.add("hidden");
      savingIcon.classList.add("hidden");
      errorIcon.classList.remove("hidden");
    } else {
      saveStatus.dataset.state = "saved";
      delete saveStatus.dataset.failed;
      saveStatus.setAttribute("aria-label", "Settings saved");
      saveStatus.removeAttribute("title");
      savedIcon.classList.remove("hidden");
      savingIcon.classList.add("hidden");
      errorIcon.classList.add("hidden");
    }
    for (const control of settingControls) {
      control.disabled = pendingWrites > 0 || permanentlyDisabled.has(control);
    }
  }

  interface WriteOptions {
    key?: string;
    onCommit?: () => void;
    onFailure?: () => void;
  }

  function runWrite(
    write: () => Promise<unknown>,
    options: WriteOptions = {}
  ): Promise<boolean> {
    const key = options.key || "custom-bangs";
    pendingWrites++;
    renderWriteState();
    const task = writeChain.then(async () => {
      await write();
      failedWrites.delete(key);
      options.onCommit?.();
    });
    writeChain = task.then(
      () => undefined,
      () => undefined
    );
    return task
      .then(() => true)
      .catch((error) => {
        failedWrites.add(key);
        options.onFailure?.();
        console.error("Failed to save settings", error);
        return false;
      })
      .finally(() => {
        pendingWrites--;
        completedWrites++;
        renderWriteState();
      });
  }

  function showValidationError(
    key: string,
    message: string,
    input?: HTMLInputElement | HTMLSelectElement
  ): void {
    validationErrors.set(key, message);
    input?.setAttribute("aria-invalid", "true");
    renderWriteState();
  }

  function clearValidationError(
    key: string,
    input?: HTMLInputElement | HTMLSelectElement
  ): void {
    validationErrors.delete(key);
    input?.removeAttribute("aria-invalid");
    renderWriteState();
  }

  window.addEventListener("beforeunload", (event) => {
    if (pendingWrites > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  renderWriteState();

  updateDefaultDisplays(activeDefaultBang);
  syncCookie();

  const mod = await import("../generated/bangs-meta.js");
  const full: Record<string, { s: string; d: string }> = mod.BANGS;
  $("#bang-status").textContent = full[defaultBang]?.s || "Unknown";
  $("#bang-count").textContent =
    `${Object.keys(full).length.toLocaleString()} bangs available`;

  defaultInput.addEventListener("change", () => {
    const val = defaultInput.value.replace(/^!+/, "").toLowerCase().trim();
    if (full[val]) {
      void runWrite(() => db.setSetting("default-bang", val), {
        key: "default-bang",
        onCommit: () => {
          activeDefaultBang = val;
          committedDefaultBang = val;
          notifySW("invalidate");
          syncCookie();
          updateDefaultDisplays(activeDefaultBang);
          flashAnim(defaultInput);
          $("#bang-status").textContent = full[val].s;
          $("#bang-status").className = "text-sm text-success";
        },
        onFailure: () => {
          defaultInput.value = committedDefaultBang;
          $("#bang-status").textContent =
            full[committedDefaultBang]?.s || "Unknown";
          $("#bang-status").className = "text-sm text-danger";
        },
      });
    } else {
      shakeAnim(defaultInput);
      $("#bang-status").textContent = "Unknown bang";
      $("#bang-status").className = "text-sm text-danger";
    }
  });

  suggestSelect.addEventListener("change", () => {
    const value = suggestSelect.value;
    if (value === "custom") {
      suggestUrlInput.classList.remove("hidden");
      const error = validateSimpleBangUrl(committedSuggestUrl);
      if (error) {
        pendingSuggestCustom = true;
        suggestSelect.value = committedSuggestProvider;
        showValidationError(
          "suggest-url",
          `Custom suggestion URL: ${error}`,
          suggestUrlInput
        );
        suggestUrlInput.focus();
        return;
      }
      pendingSuggestCustom = false;
    } else {
      pendingSuggestCustom = false;
      suggestUrlInput.classList.add("hidden");
    }
    clearValidationError("suggest-url", suggestUrlInput);
    void runWrite(() => db.setSetting("suggest-provider", value), {
      key: "suggest-provider",
      onCommit: () => {
        committedSuggestProvider = value;
        syncCookie();
        updateDefaultDisplays(activeDefaultBang);
      },
      onFailure: () => {
        suggestSelect.value = committedSuggestProvider;
        suggestUrlInput.classList.toggle(
          "hidden",
          committedSuggestProvider !== "custom"
        );
        updateDefaultDisplays(activeDefaultBang);
      },
    });
  });

  suggestUrlInput.addEventListener("change", () => {
    const value = suggestUrlInput.value.trim();
    let error = value ? validateSimpleBangUrl(value) : null;
    if (!value && committedSuggestProvider === "custom") {
      error = "URL must contain {} for the query";
    }
    if (error) {
      showValidationError(
        "suggest-url",
        `Invalid suggestion URL: ${error}`,
        suggestUrlInput
      );
      return;
    }
    clearValidationError("suggest-url", suggestUrlInput);
    void runWrite(() => db.setSetting("suggest-url", value), {
      key: "suggest-url",
      onCommit: () => {
        committedSuggestUrl = value;
        syncCookie();
        if (pendingSuggestCustom) {
          pendingSuggestCustom = false;
          suggestSelect.value = "custom";
          suggestSelect.dispatchEvent(new Event("change"));
        }
      },
      onFailure: () => {
        suggestUrlInput.value = committedSuggestUrl;
      },
    });
  });

  luckySelect.addEventListener("change", () => {
    const value = luckySelect.value;
    if (value === "custom") {
      luckyUrlInput.classList.remove("hidden");
      const error = validateSimpleBangUrl(committedLuckyUrl);
      if (error) {
        pendingLuckyCustom = true;
        luckySelect.value = committedLuckyProvider;
        showValidationError(
          "lucky-url",
          `Custom lucky URL: ${error}`,
          luckyUrlInput
        );
        luckyUrlInput.focus();
        return;
      }
      pendingLuckyCustom = false;
    } else {
      pendingLuckyCustom = false;
      luckyUrlInput.classList.add("hidden");
    }
    clearValidationError("lucky-url", luckyUrlInput);
    void runWrite(() => db.setSetting("lucky-provider", value), {
      key: "lucky-provider",
      onCommit: () => {
        committedLuckyProvider = value;
        notifySW("invalidate");
        updateDefaultDisplays(activeDefaultBang);
      },
      onFailure: () => {
        luckySelect.value = committedLuckyProvider;
        luckyUrlInput.classList.toggle(
          "hidden",
          committedLuckyProvider !== "custom"
        );
        updateDefaultDisplays(activeDefaultBang);
      },
    });
  });

  luckyUrlInput.addEventListener("change", () => {
    const value = luckyUrlInput.value.trim();
    let error = value ? validateSimpleBangUrl(value) : null;
    if (!value && committedLuckyProvider === "custom") {
      error = "URL must contain {} for the query";
    }
    if (error) {
      showValidationError(
        "lucky-url",
        `Invalid lucky URL: ${error}`,
        luckyUrlInput
      );
      return;
    }
    clearValidationError("lucky-url", luckyUrlInput);
    void runWrite(() => db.setSetting("lucky-url", value), {
      key: "lucky-url",
      onCommit: () => {
        committedLuckyUrl = value;
        notifySW("invalidate");
        if (pendingLuckyCustom) {
          pendingLuckyCustom = false;
          luckySelect.value = "custom";
          luckySelect.dispatchEvent(new Event("change"));
        }
      },
      onFailure: () => {
        luckyUrlInput.value = committedLuckyUrl;
      },
    });
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

  const refreshCustomBangs = setupCustomBangs(
    db,
    (nextCustom) => {
      custom = nextCustom;
      syncCookie();
    },
    runWrite
  );

  exportButton.addEventListener("click", async () => {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `flashbang-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      $("#import-status").textContent = "Exported settings successfully";
      $("#import-status").className = "text-sm mt-2 block text-success";
    } catch (error) {
      $("#import-status").textContent =
        error instanceof Error
          ? `Export failed: ${error.message}`
          : "Export failed";
      $("#import-status").className = "text-sm mt-2 block text-danger";
    }
  });

  importFile.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const preview = await db.importAll(data, () => false);
      const summary = `${preview.importedSettings} settings, ${preview.acceptedCustomBangs} custom bangs accepted, ${preview.rejectedCustomBangs} rejected`;
      $("#import-status").textContent = `Ready to replace: ${summary}`;
      $("#import-status").className = "text-sm mt-2 block text-text-secondary";
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      if (!window.confirm(`Replace current settings?\n\n${summary}`)) {
        $("#import-status").textContent = `Import canceled: ${summary}`;
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
      const importedSettings = await db.getMultipleSettings([
        "default-bang",
        "suggest-provider",
        "suggest-url",
        "lucky-provider",
        "lucky-url",
      ]);
      committedDefaultBang = importedSettings[0] || "g";
      committedSuggestProvider = isFirefox
        ? "google"
        : importedSettings[1] || "default";
      committedSuggestUrl = importedSettings[2] || "";
      committedLuckyProvider = importedSettings[3] || "default";
      committedLuckyUrl = importedSettings[4] || "";
      activeDefaultBang = committedDefaultBang;
      defaultInput.value = committedDefaultBang;
      $("#bang-status").textContent =
        full[committedDefaultBang]?.s || "Unknown";
      $("#bang-status").className = full[committedDefaultBang]
        ? "text-sm text-success"
        : "text-sm text-danger";
      suggestUrlInput.value = committedSuggestUrl;
      suggestUrlInput.removeAttribute("aria-invalid");
      if (!isFirefox) {
        suggestSelect.value = committedSuggestProvider;
        suggestUrlInput.classList.toggle(
          "hidden",
          committedSuggestProvider !== "custom"
        );
      }
      luckySelect.value = committedLuckyProvider;
      luckyUrlInput.value = committedLuckyUrl;
      luckyUrlInput.removeAttribute("aria-invalid");
      luckyUrlInput.classList.toggle(
        "hidden",
        committedLuckyProvider !== "custom"
      );
      pendingSuggestCustom = false;
      pendingLuckyCustom = false;
      validationErrors.clear();
      failedWrites.clear();
      updateDefaultDisplays(activeDefaultBang);
      await refreshCustomBangs();
      syncCookie();
      notifySW("invalidate");
      renderWriteState();
      $("#import-status").textContent =
        `Imported: ${result.importedSettings} settings, ${result.acceptedCustomBangs} custom bangs accepted, ${result.rejectedCustomBangs} rejected`;
      $("#import-status").className =
        result.rejectedCustomBangs > 0
          ? "text-sm mt-2 block text-danger"
          : "text-sm mt-2 block text-success";
    } catch (error) {
      $("#import-status").textContent =
        error instanceof Error ? error.message : "Invalid file";
      $("#import-status").className = "text-sm mt-2 block text-danger";
    } finally {
      importFile.value = "";
    }
  });
}
