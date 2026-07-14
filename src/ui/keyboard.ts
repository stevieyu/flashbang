export function setupVimBlurShortcut(): void {
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "[" ||
      !event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const active = document.activeElement;
    if (
      !(
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    active.blur();
  });
}
