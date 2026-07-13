import {
  type CaptureEncoding,
  validateCaptureBang,
  validateSimpleBangUrl,
} from "../shared/capture-template";
import { validateSnapTarget } from "../shared/snap-target";
import type { DB } from "./db";
import { $, el } from "./dom";
import { notifySW } from "./sw-bridge";

async function renderCustom(
  db: DB,
  onChange?: (customTriggers: string[]) => void
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
      const rmBtn = el("button", "btn-danger", "remove");
      rmBtn.addEventListener("click", async () => {
        await db.removeCustomBang(b.trigger);
        notifySW("invalidate");
        await renderCustom(db, onChange);
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
  void renderCustom(db, onChange);

  $<HTMLFormElement>("#add-bang-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
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
    const error = $("#custom-bang-error");
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
    await db.addCustomBang({
      trigger,
      name,
      url,
      ...(regex ? { regex, encoding } : {}),
      ...(snap ? { snap } : {}),
    });
    notifySW("invalidate");
    form.reset();
    await renderCustom(db, onChange);
  });
}
