export function setupHomeShortcuts(input: HTMLInputElement): void {
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
}
