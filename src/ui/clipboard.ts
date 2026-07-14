export async function copyText(
  text: string,
  fallbackInput?: HTMLInputElement
): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API without permission.
    }
  }

  const target = fallbackInput ?? document.createElement("textarea");
  const temporary = fallbackInput === undefined;
  target.value = text;
  if (temporary) {
    target.setAttribute("aria-hidden", "true");
    target.style.position = "fixed";
    target.style.opacity = "0";
    document.body.append(target);
  }

  let copied = false;
  try {
    target.select();
    copied = document.execCommand("copy");
  } finally {
    if (temporary) {
      target.remove();
    } else {
      target.setSelectionRange(0, 0);
    }
  }
  if (!copied) {
    throw new Error("Clipboard write failed");
  }
}
