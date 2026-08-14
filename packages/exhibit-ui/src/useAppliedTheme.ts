import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CapitolSettings, UpdateCapitolSettingsRequest } from "@congress/shared-types";

async function fetchCapitolSettings(): Promise<CapitolSettings> {
  const res = await fetch("/capitol/settings");
  if (!res.ok) return { darkMode: false };
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
export function useAppliedTheme(): void {
  const forced = forcedThemeFromUrl();
  const { data } = useCapitolSettings(forced === null);

  useEffect(() => {
    document.documentElement.dataset.theme = forced ?? (data?.darkMode ? "dark" : "light");
  }, [forced, data?.darkMode]);
}
