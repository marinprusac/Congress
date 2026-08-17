import type { CapitolSettings, UpdateCapitolSettingsRequest } from "@congress/shared-types";

export async function updateCapitolSettings(input: UpdateCapitolSettingsRequest): Promise<CapitolSettings> {
  const res = await fetch("/capitol/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`);
  return res.json();
}
