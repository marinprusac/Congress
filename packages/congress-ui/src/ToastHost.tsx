import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail } from "./toast.js";

interface ActiveToast extends ToastDetail {
  id: number;
}

const DISMISS_AFTER_MS = 3200;

let nextId = 0;

// Mounted once per app (each main.tsx renders it as a sibling of <App />) -
// listens on `window`, so it catches showToast() calls from anywhere in the
// same document, including a Chamber dynamically mounted inside Capitol's
// shell (see toast.ts's comment for why this can't be a React Context).
export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      const id = nextId++;
      setToasts((current) => [...current, { ...detail, id }]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_AFTER_MS);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.variant === "error" ? "toast toast-error" : "toast"}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
