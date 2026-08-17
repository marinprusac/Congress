// A plain DOM CustomEvent, not a React Context - congress-ui is a
// source-only workspace package recompiled independently into Capitol's own
// bundle and every Chamber's remote entry (see ShellHostContext's comment
// for the full reasoning), so a Context object created in one bundle isn't
// recognized by useContext() in another even though it's "the same" source
// file. showToast() can be called from any bundle; ToastHost (mounted once
// per document, from each app's own main.tsx) is the one thing that needs
// to actually be listening, and `window` is shared regardless of bundle.
export const TOAST_EVENT = "congress:toast";

export interface ToastDetail {
  message: string;
  variant?: "success" | "error";
}

export function showToast(message: string, variant: ToastDetail["variant"] = "success"): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, variant } }));
}
