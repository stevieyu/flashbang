import { $ } from "../dom";
import { setupDialog } from "../modal";

async function copyInput(input: HTMLInputElement): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(input.value);
    return;
  }
  input.select();
  document.execCommand("copy");
  input.setSelectionRange(0, 0);
}

export function setupAddressBarSheet(): void {
  const modal = $("#setup-modal");
  const openButton = $<HTMLButtonElement>("#open-setup");
  const closeButton = $<HTMLButtonElement>("#setup-close");
  const status = $("#setup-copy-status");
  const searchUrl = $<HTMLInputElement>("#setup-search-url");
  const suggestUrl = $<HTMLInputElement>("#setup-suggest-url");

  searchUrl.value = `${location.origin}?q=%s`;
  suggestUrl.value = `${location.origin}/suggest?q=%s`;

  setupDialog({ closeButton, modal, openButton });

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

  for (const [buttonId, input] of [
    ["#copy-search-url", searchUrl],
    ["#copy-suggest-url", suggestUrl],
  ] as const) {
    const button = $<HTMLButtonElement>(buttonId);
    button.addEventListener("click", () => void copy(input, button));
    input.addEventListener("click", () => input.select());
  }
}
