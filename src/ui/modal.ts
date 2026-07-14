interface DialogOptions {
  closeButton: HTMLElement;
  modal: HTMLElement;
  onFirstOpen?: () => void;
  openButton: HTMLElement;
}

export function setupDialog({
  closeButton,
  modal,
  onFirstOpen,
  openButton,
}: DialogOptions) {
  const cardElement = modal.querySelector<HTMLElement>('[role="dialog"]');
  if (!cardElement) {
    throw new Error("Dialog card not found");
  }
  const card: HTMLElement = cardElement;

  let initialized = false;
  let previousBodyOverflow = "";
  openButton.setAttribute("aria-expanded", "false");

  function openDialog(): void {
    if (modal.classList.contains("open")) {
      return;
    }
    if (!initialized) {
      initialized = true;
      onFirstOpen?.();
    }
    modal.classList.replace("opacity-0", "opacity-100");
    modal.classList.replace("invisible", "visible");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    openButton.setAttribute("aria-expanded", "true");
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function closeDialog(): void {
    if (!modal.classList.contains("open")) {
      return;
    }
    modal.classList.replace("opacity-100", "opacity-0");
    modal.classList.replace("visible", "invisible");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    openButton.setAttribute("aria-expanded", "false");
    document.body.style.overflow = previousBodyOverflow;
    openButton.focus();
  }

  openButton.addEventListener("click", openDialog);
  closeButton.addEventListener("click", closeDialog);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDialog();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("open")) {
      closeDialog();
    }
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = card.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }
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

  return { closeDialog, openDialog };
}
