// Shared between the Settings recorder (ConfirmShortcutSetting) and the
// confirm toast's hotkey hint, so the two always spell the shortcut the
// same way.

const CODE_LABELS: Record<string, string> = {
  Space: "Spazio",
  Enter: "Invio",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Canc",
  Insert: "Ins",
  Home: "Home",
  End: "Fine",
  PageUp: "Pag↑",
  PageDown: "Pag↓",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  CapsLock: "BlocMaiusc",
  NumLock: "BlocNum",
  ScrollLock: "BlocScorr",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
};

const MODIFIER_LABELS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

export function labelForCode(code: string): string {
  if (CODE_LABELS[code]) {
    return CODE_LABELS[code];
  }
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
  }
  return code;
}

// Turns the stored accelerator ("CommandOrControl+Shift+KeyY") or a mouse
// binding ("Mouse4") into what the user actually recognizes on their
// keyboard/mouse — the stored form has to match what the Rust side's parser
// expects, not what's readable.
export function formatAccelerator(value: string): string {
  if (value === "Mouse4" || value === "Mouse5") {
    return value.replace("Mouse", "Mouse ");
  }
  return value
    .split("+")
    .map((token) => MODIFIER_LABELS[token] ?? labelForCode(token))
    .join(" + ");
}
