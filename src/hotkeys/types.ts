/** Single atom-targeted keyboard binding. */
export interface HotkeyEntry {
  /** The character pressed. Case-sensitive: "m" ≠ "M". */
  key: string;
  /** The command class. */
  command: HotkeyCommand;
  /** Command-specific value (label string for LABELTEXT, numeric code for SPROUT). */
  value: string;
  /** Human-readable description shown in the help overlay. */
  description: string;
}

export type HotkeyCommand =
  | "LABELTEXT"
  | "SPROUT"
  | "CHARGE"
  | "FREE_SITE"
  | "UPTO_SITE"
  | "EXACT_SITE"
  | "ATOMNUMBER"
  | "ATTACHMENTPOINT"
  | "SELECT";

/** Top-level shape of `hotkeys.json`. */
export interface HotkeysData {
  /** All atom-targeted hotkey entries. */
  entries: HotkeyEntry[];
}
