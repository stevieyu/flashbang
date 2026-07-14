import { validateSimpleBangUrl } from "../../shared/capture-template";
import {
  DEFAULT_LUCKY_PROVIDER,
  LUCKY_TRIGGER_PROVIDERS,
  SUGGEST_TRIGGER_PROVIDERS,
} from "../../shared/constants";
import type { DB } from "../db";
import { $ } from "../dom";
import { notifySW } from "../sw-bridge";
import { setupFirefoxSuggestions } from "./firefox";
import type { SettingsWriter } from "./write";

export interface ProviderControls {
  luckySelect: HTMLSelectElement;
  luckyUrlInput: HTMLInputElement;
  suggestSelect: HTMLSelectElement;
  suggestUrlInput: HTMLInputElement;
}

export interface ProviderSettingsState {
  defaultBang: string;
  luckyProvider: string;
  luckyUrl: string;
  suggestProvider: string;
  suggestUrl: string;
}

interface ProviderSettingsOptions {
  controls: ProviderControls;
  db: DB;
  onSuggestChange: () => void;
  state: ProviderSettingsState;
  writer: SettingsWriter;
}

export interface ProviderSettingsController {
  isFirefox: boolean;
  refresh: () => void;
  updateDefaultDisplays: () => void;
}

export function getProviderControls(): ProviderControls {
  return {
    luckySelect: $<HTMLSelectElement>("#lucky-provider"),
    luckyUrlInput: $<HTMLInputElement>("#lucky-url"),
    suggestSelect: $<HTMLSelectElement>("#suggest-provider"),
    suggestUrlInput: $<HTMLInputElement>("#suggest-url"),
  };
}

function setDefaultDisplay(
  select: HTMLSelectElement,
  display: HTMLElement,
  prefix: HTMLElement,
  providerBadge: HTMLElement,
  matchedProvider: string | undefined,
  fallbackProvider: string
): void {
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

export function setupProviderSettings({
  controls,
  db,
  onSuggestChange,
  state,
  writer,
}: ProviderSettingsOptions): ProviderSettingsController {
  const { luckySelect, luckyUrlInput, suggestSelect, suggestUrlInput } =
    controls;
  const luckyDefaultDisplay = $("#lucky-default-display");
  const luckyDefaultPrefix = $("#lucky-default-prefix");
  const luckyDefaultProvider = $("#lucky-default-provider");
  const suggestDefaultDisplay = $("#suggest-default-display");
  const suggestDefaultPrefix = $("#suggest-default-prefix");
  const suggestDefaultProvider = $("#suggest-default-provider");
  const isFirefox = /Firefox\//.test(navigator.userAgent);
  let pendingSuggestCustom = false;
  let pendingLuckyCustom = false;

  function updateDefaultDisplays(): void {
    setDefaultDisplay(
      luckySelect,
      luckyDefaultDisplay,
      luckyDefaultPrefix,
      luckyDefaultProvider,
      LUCKY_TRIGGER_PROVIDERS[state.defaultBang],
      DEFAULT_LUCKY_PROVIDER
    );
    setDefaultDisplay(
      suggestSelect,
      suggestDefaultDisplay,
      suggestDefaultPrefix,
      suggestDefaultProvider,
      SUGGEST_TRIGGER_PROVIDERS[state.defaultBang],
      "none"
    );
  }

  function refresh(): void {
    suggestUrlInput.value = state.suggestUrl;
    suggestUrlInput.removeAttribute("aria-invalid");
    if (!isFirefox) {
      suggestSelect.value = state.suggestProvider;
      suggestUrlInput.classList.toggle(
        "hidden",
        state.suggestProvider !== "custom"
      );
    }
    luckySelect.value = state.luckyProvider;
    luckyUrlInput.value = state.luckyUrl;
    luckyUrlInput.removeAttribute("aria-invalid");
    luckyUrlInput.classList.toggle("hidden", state.luckyProvider !== "custom");
    pendingSuggestCustom = false;
    pendingLuckyCustom = false;
    updateDefaultDisplays();
  }

  if (isFirefox) {
    state.suggestProvider = "google";
    setupFirefoxSuggestions(controls, writer);
  }
  refresh();

  suggestSelect.addEventListener("change", () => {
    const value = suggestSelect.value;
    if (value === "custom") {
      suggestUrlInput.classList.remove("hidden");
      const error = validateSimpleBangUrl(state.suggestUrl);
      if (error) {
        pendingSuggestCustom = true;
        suggestSelect.value = state.suggestProvider;
        writer.showValidationError(
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
    writer.clearValidationError("suggest-url", suggestUrlInput);
    void writer.run(() => db.setSetting("suggest-provider", value), {
      key: "suggest-provider",
      onCommit: () => {
        state.suggestProvider = value;
        onSuggestChange();
        updateDefaultDisplays();
      },
      onFailure: () => {
        suggestSelect.value = state.suggestProvider;
        suggestUrlInput.classList.toggle(
          "hidden",
          state.suggestProvider !== "custom"
        );
        updateDefaultDisplays();
      },
    });
  });

  suggestUrlInput.addEventListener("change", () => {
    const value = suggestUrlInput.value.trim();
    let error = value ? validateSimpleBangUrl(value) : null;
    if (!value && state.suggestProvider === "custom") {
      error = "URL must contain {} for the query";
    }
    if (error) {
      writer.showValidationError(
        "suggest-url",
        `Invalid suggestion URL: ${error}`,
        suggestUrlInput
      );
      return;
    }
    writer.clearValidationError("suggest-url", suggestUrlInput);
    void writer.run(() => db.setSetting("suggest-url", value), {
      key: "suggest-url",
      onCommit: () => {
        state.suggestUrl = value;
        onSuggestChange();
        if (pendingSuggestCustom) {
          pendingSuggestCustom = false;
          suggestSelect.value = "custom";
          suggestSelect.dispatchEvent(new Event("change"));
        }
      },
      onFailure: () => {
        suggestUrlInput.value = state.suggestUrl;
      },
    });
  });

  luckySelect.addEventListener("change", () => {
    const value = luckySelect.value;
    if (value === "custom") {
      luckyUrlInput.classList.remove("hidden");
      const error = validateSimpleBangUrl(state.luckyUrl);
      if (error) {
        pendingLuckyCustom = true;
        luckySelect.value = state.luckyProvider;
        writer.showValidationError(
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
    writer.clearValidationError("lucky-url", luckyUrlInput);
    void writer.run(() => db.setSetting("lucky-provider", value), {
      key: "lucky-provider",
      onCommit: () => {
        state.luckyProvider = value;
        notifySW("invalidate");
        updateDefaultDisplays();
      },
      onFailure: () => {
        luckySelect.value = state.luckyProvider;
        luckyUrlInput.classList.toggle(
          "hidden",
          state.luckyProvider !== "custom"
        );
        updateDefaultDisplays();
      },
    });
  });

  luckyUrlInput.addEventListener("change", () => {
    const value = luckyUrlInput.value.trim();
    let error = value ? validateSimpleBangUrl(value) : null;
    if (!value && state.luckyProvider === "custom") {
      error = "URL must contain {} for the query";
    }
    if (error) {
      writer.showValidationError(
        "lucky-url",
        `Invalid lucky URL: ${error}`,
        luckyUrlInput
      );
      return;
    }
    writer.clearValidationError("lucky-url", luckyUrlInput);
    void writer.run(() => db.setSetting("lucky-url", value), {
      key: "lucky-url",
      onCommit: () => {
        state.luckyUrl = value;
        notifySW("invalidate");
        if (pendingLuckyCustom) {
          pendingLuckyCustom = false;
          luckySelect.value = "custom";
          luckySelect.dispatchEvent(new Event("change"));
        }
      },
      onFailure: () => {
        luckyUrlInput.value = state.luckyUrl;
      },
    });
  });

  return { isFirefox, refresh, updateDefaultDisplays };
}
