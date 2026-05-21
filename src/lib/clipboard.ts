/**
 * Copy rich content (an HTML table + plain-text fallback) to the clipboard in
 * a way that also works on **insecure origins** (plain http, e.g. accessing the
 * dev server over the LAN). `navigator.clipboard.write`/`writeText` require a
 * secure context, so on http they're unavailable or reject — which is why the
 * Copy button "did nothing". We fall back to a hidden contenteditable element +
 * `document.execCommand("copy")`, which still works on http.
 *
 * @returns true if the copy succeeded by any path.
 */
export async function copyRich(html: string, text: string): Promise<boolean> {
  // 1) Modern async Clipboard API (secure contexts only).
  try {
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard?.write &&
      window.isSecureContext
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  // 2) execCommand fallback — copies a real HTML selection (works on http).
  try {
    if (copyHtmlViaExecCommand(html)) return true;
  } catch {
    // fall through to plain text
  }

  // 3) Last resort: plain-text writeText (may still work in some contexts).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  // 4) Plain-text via a hidden textarea + execCommand.
  return copyTextViaExecCommand(text);
}

/** Select an off-screen contenteditable holding `html` and run copy. */
function copyHtmlViaExecCommand(html: string): boolean {
  const holder = document.createElement("div");
  holder.setAttribute("contenteditable", "true");
  holder.innerHTML = html;
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.opacity = "0";
  document.body.appendChild(holder);

  const selection = window.getSelection();
  const prev = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);

  try {
    return document.execCommand("copy");
  } finally {
    selection?.removeAllRanges();
    if (prev) selection?.addRange(prev);
    document.body.removeChild(holder);
  }
}

/** Plain-text copy via a hidden textarea + execCommand. */
function copyTextViaExecCommand(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-99999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
