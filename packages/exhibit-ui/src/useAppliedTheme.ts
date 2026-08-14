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

export function useCapitolSettings() {
  return useQuery({ queryKey: capitolSettingsQueryKey(), queryFn: fetchCapitolSettings });
}

// Fetches the owner's Congress-wide dark mode preference and applies it as
// a data-theme attribute on the document root, which styles.css's dark
// palette override keys off. Called once near the root of every Congress
// frontend - Capitol and each Chamber - so the preference holds no matter
// which app is currently open, the same "one setting, every device/app"
// requirement Notes' autosave setting already established.
export function useAppliedTheme(): void {
  const { data } = useCapitolSettings();

  useEffect(() => {
    document.documentElement.dataset.theme = data?.darkMode ? "dark" : "light";
  }, [data?.darkMode]);
}
