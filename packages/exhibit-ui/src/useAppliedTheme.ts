import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CapitolSettings, UpdateCapitolSettingsRequest } from "@congress/shared-types";

async function fetchCapitolSettings(): Promise<CapitolSettings> {
  const res = await fetch("/capitol/settings");
  if (!res.ok) return { darkMode: false, hiddenWidgets: [] };
  return res.json();
}

export async function updateCapitolSettings(input: UpdateCapitolSettingsRequest): Promise<CapitolSettings> {
  const res = await fetch("/capitol/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`);
  return res.json();
}

export function capitolSettingsQueryKey() {
  return ["capitol-settings"] as const;
}

export function useCapitolSettings(enabled: boolean = true) {
  return useQuery({ queryKey: capitolSettingsQueryKey(), queryFn: fetchCapitolSettings, enabled });
}

function forcedThemeFromUrl(): "dark" | "light" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("theme");
  return value === "dark" || value === "light" ? value : null;
}

// Same key the bootstrap <script> in every frontend's index.html reads
// synchronously before first paint (see that script for why) - keep the
// two in sync by hand, since the inline script can't import this module.
const THEME_STORAGE_KEY = "congress-theme";

// Fetches the owner's Congress-wide dark mode preference and applies it as
// a data-theme attribute on the document root, which styles.css's dark
// palette override keys off. Called once near the root of every Congress
// frontend - Capitol and each Chamber - so the preference holds no matter
// which app is currently open, the same "one setting, every device/app"
// requirement Notes' autosave setting already established.
//
// A Chamber's homepage widget (rendered in an <iframe>, see Capitol's
// WidgetGrid) is its own separate document - CSS custom properties don't
// cross iframe boundaries, so it can't just inherit Capitol's applied
// theme, and can't be assumed to share Capitol's cookies/fetches reliably
// either. Capitol already knows the current setting for its own page, so
// it passes it along explicitly as a ?theme= param on the iframe's src
// instead of making every embedded widget independently fetch its own
// copy - this branch applies that directly and skips the fetch entirely.
//
// Two things guard against a flash of the wrong theme:
//  - The fetch takes a moment, and while it's pending `data` is undefined.
//    Leaving the attribute untouched in that case (rather than falling
//    back to "light") matters because the bootstrap script below already
//    set it correctly from a cached value before this component even
//    mounted - overwriting that with a hardcoded default would itself
//    cause a light-then-dark flash independent of the fetch.
//  - Once resolved, the value is cached to localStorage so the *next*
//    load's bootstrap script has a same-origin-shared, synchronous answer
//    instead of guessing - this is a paint-time cache, not a source of
//    truth, so a changed setting still self-corrects the moment the fetch
//    on the new load resolves.
export function useAppliedTheme(): void {
  const forced = forcedThemeFromUrl();
  const { data } = useCapitolSettings(forced === null);

  useEffect(() => {
    const theme = forced ?? (data ? (data.darkMode ? "dark" : "light") : null);
    if (theme === null) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [forced, data]);
}
