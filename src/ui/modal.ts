import { $ } from "./dom";

export function setupModal(onFirstOpen: () => void) {
  const modal = $("#settings-modal");
  const gearBtn = $("#gear-btn");
  const closeBtn = $("#modal-close");
  const card = modal.querySelector('[role="dialog"]') as HTMLElement;

  let initialized = false;

  function openModal() {
    if (!initialized) {
      initialized = true;
      onFirstOpen();
    }
    modal.classList.replace("opacity-0", "opacity-100");
    modal.classList.replace("invisible", "visible");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    card.classList.replace("translate-y-2", "translate-y-0");
    gearBtn.classList.add("rotate-180");
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }

  function closeModal() {
    modal.classList.replace("opacity-100", "opacity-0");
    modal.classList.replace("visible", "invisible");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    card.classList.replace("translate-y-0", "translate-y-2");
    gearBtn.classList.remove("rotate-180");
    document.body.style.overflow = "";
    gearBtn.focus();
  }

  gearBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) {
      closeModal();
    }
  });

  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") {
      return;
    }
    const focusable = card.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return { openModal };
}
