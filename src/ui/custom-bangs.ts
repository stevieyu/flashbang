import {
  type CaptureEncoding,
  type CustomBangRecord,
  validateCaptureBang,
  validateSimpleBangUrl,
} from "../shared/capture-template";
import { validateSnapTarget } from "../shared/snap-target";
import type { DB } from "./db";
import { $, el } from "./dom";
import { notifySW } from "./sw-bridge";

async function renderCustom(
  db: DB,
  onChange: ((customTriggers: string[]) => void) | undefined,
  onEdit: (bang: CustomBangRecord) => void,
  onRemove: (trigger: string) => void
) {
  const custom = await db.getAllCustomBangs();
  onChange?.(custom.map((b) => b.trigger));
  const list = $("#custom-list");
  if (custom.length === 0) {
    list.replaceChildren(
      el("div", "text-sm text-text-secondary", "No custom bangs yet")
    );
    return;
  }
  list.replaceChildren(
    ...custom.map((b) => {
      const row = el(
        "div",
        "flex items-center gap-2.5 p-2.5 mb-1.5 rounded-lg bg-bg-secondary"
      );
      const editBtn = el("button", "btn px-2 py-1 text-xs", "edit");
      editBtn.addEventListener("click", () => onEdit(b));
      const rmBtn = el("button", "btn-danger", "remove");
      rmBtn.addEventListener("click", async () => {
        await db.removeCustomBang(b.trigger);
        onRemove(b.trigger);
        notifySW("invalidate");
        await renderCustom(db, onChange, onEdit, onRemove);
      });
      row.append(
        el(
          "code",
          "px-1.5 py-0.5 rounded bg-bg-active text-xs min-w-15 text-center font-mono",
          `!${b.trigger}`
        ),
        el("span", "flex-1 text-[13px] font-medium", b.name),
        ...(b.regex
          ? [
              el(
                "span",
                "rounded-full bg-bg-active px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary",
                "regex"
              ),
            ]
          : []),
        ...(b.snap
          ? [
              el(
                "span",
                "rounded-full bg-bg-active px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary",
                "snap"
              ),
            ]
          : []),
        editBtn,
        rmBtn
      );
      return row;
    })
  );
}

export function setupCustomBangs(
  db: DB,
  onChange?: (customTriggers: string[]) => void
) {
  const form = $<HTMLFormElement>("#add-bang-form");
  const shortcutInput = form.elements.namedItem("shortcut") as HTMLInputElement;
  const nameInput = form.elements.namedItem("name") as HTMLInputElement;
  const urlInput = form.elements.namedItem("url") as HTMLInputElement;
  const regexInput = form.elements.namedItem("regex") as HTMLInputElement;
  const snapInput = form.elements.namedItem("snap") as HTMLInputElement;
  const encodingInput = form.elements.namedItem(
    "encoding"
  ) as HTMLSelectElement;
  const advanced = form.querySelector("details") as HTMLDetailsElement;
  const submitButton = $<HTMLButtonElement>("#custom-bang-submit");
  const cancelButton = $<HTMLButtonElement>("#custom-bang-cancel");
  const error = $("#custom-bang-error");
  let editingTrigger: string | null = null;

  function resetForm(): void {
    editingTrigger = null;
    form.reset();
    advanced.open = false;
    submitButton.textContent = "Add Bang";
    cancelButton.classList.add("hidden");
    error.textContent = "";
    error.classList.add("hidden");
  }

  function editBang(bang: CustomBangRecord): void {
    editingTrigger = bang.trigger;
    shortcutInput.value = bang.trigger;
    nameInput.value = bang.name;
    urlInput.value = bang.url;
    regexInput.value = bang.regex ?? "";
    snapInput.value = bang.snap ?? "";
    encodingInput.value = bang.encoding ?? "percent";
    advanced.open = Boolean(bang.regex || bang.snap);
    submitButton.textContent = "Save Changes";
    cancelButton.classList.remove("hidden");
    error.textContent = "";
    error.classList.add("hidden");
    form.scrollIntoView({ block: "nearest" });
    shortcutInput.focus();
  }

  function removedBang(trigger: string): void {
    if (editingTrigger === trigger) {
      resetForm();
    }
  }

  const refresh = () => renderCustom(db, onChange, editBang, removedBang);

  void refresh();
  cancelButton.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const trigger = (fd.get("shortcut") as string)
      .replace(/^!+/, "")
      .toLowerCase()
      .trim();
    const name = (fd.get("name") as string).trim();
    const url = (fd.get("url") as string).trim();
    const regex = (fd.get("regex") as string).trim();
    const snap = (fd.get("snap") as string).trim();
    const encoding = fd.get("encoding") as CaptureEncoding;
    error.textContent = "";
    error.classList.add("hidden");
    if (!(trigger && name && url)) {
      return;
    }
    const urlError = regex
      ? validateCaptureBang(url, regex)
      : validateSimpleBangUrl(url);
    const validationError =
      urlError ?? (snap ? validateSnapTarget(snap) : null);
    if (validationError) {
      error.textContent = validationError;
      error.classList.remove("hidden");
      return;
    }
    const bang: CustomBangRecord = {
      trigger,
      name,
      url,
      ...(regex ? { regex, encoding } : {}),
      ...(snap ? { snap } : {}),
    };
    if (editingTrigger === null) {
      await db.addCustomBang(bang);
    } else {
      await db.updateCustomBang(editingTrigger, bang);
    }
    notifySW("invalidate");
    resetForm();
    await refresh();
  });
}
