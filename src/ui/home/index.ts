import type { DB } from "../db";
import { setupAddressBarSheet } from "./address-bar-setup";
import { setupBangCommand } from "./command";
import { setupHomeShortcuts } from "./shortcuts";

export function initHome(db: DB): void {
  const input = setupBangCommand(db);
  setupHomeShortcuts(input);
  setupAddressBarSheet();
}
