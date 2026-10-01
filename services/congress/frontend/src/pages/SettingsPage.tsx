import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ChamberHeader,
  useAppliedTheme,
  useCapitolSettings,
  capitolSettingsQueryKey,
  updateCapitolSettings,
  useBackNavigation,
} from "@congress/congress-ui";
import { SignOutControl } from "@/components/LoginGate";
import { LogsTab } from "@/pages/LogsTab";
import { AiSettingsTab } from "@/pages/AiSettingsTab";
import { HomeSettingsTab } from "@/pages/HomeSettingsTab";
import { ConnectorsTab } from "@/pages/ConnectorsTab";
import { TypesSettingsTab } from "@/pages/TypesSettingsTab";

function SettingsGearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6 text-ink"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

// Dark mode and sign-out.
function GeneralTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useCapitolSettings();

  const mutation = useMutation({
    mutationFn: updateCapitolSettings,
    onSuccess: (updated) => queryClient.setQueryData(capitolSettingsQueryKey(), updated),
  });

  return (
    <div>
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load settings.</p>}

      {data && (
        <div className="space-y-6">
          <div>
            <label className="flex items-center gap-2 font-mono text-sm text-ink">
              <input
                type="checkbox"
                checked={data.darkMode}
                onChange={(e) => mutation.mutate({ darkMode: e.target.checked })}
              />
              Dark mode
            </label>
            <p className="mt-1 pl-6 font-mono text-xs text-dust">Applies across Congress and every Chamber, on any device.</p>
          </div>
        </div>
      )}

      <div className="mt-10 border-t border-dust pt-6">
        <SignOutControl />
      </div>
    </div>
  );
}

const SETTINGS_TABS = ["general", "home", "logs", "ai", "accounts", "types"];

// Unified Settings, reached from the tab bar; "?from=<tab>" opens one
// (e.g. the AI-paused banners' "?from=ai").
export function SettingsPage() {
  useAppliedTheme();
  const back = useBackNavigation();

  // A link can open Settings straight to a tab with "?from=<tab>" (e.g. the
  // AI-paused banners' "?from=ai", Home's pin bubble "?from=home") - a bare
  // "/settings" (the tab bar) falls back to General.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("from");

  const [tab, setTab] = useState<string>(SETTINGS_TABS.includes(requestedTab ?? "") ? (requestedTab as string) : "general");

  return (
    <div className="chamber-shell">
      <ChamberHeader
        icon={<SettingsGearIcon />}
        title="Settings"
        titleHref=""
        onBack={back}
      />
      <main className="chamber-main">
        <div className="settings-tabs" role="tablist" aria-label="Settings categories">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "general"}
            className={tab === "general" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "home"}
            className={tab === "home" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "logs"}
            className={tab === "logs" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("logs")}
          >
            Logs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ai"}
            className={tab === "ai" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("ai")}
          >
            AI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "accounts"}
            className={tab === "accounts" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("accounts")}
          >
            Connectors
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "types"}
            className={tab === "types" ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab("types")}
          >
            Types
          </button>
        </div>
        <section className="settings-tab-panel">
          {tab === "general" ? (
            <GeneralTab />
          ) : tab === "home" ? (
            <HomeSettingsTab />
          ) : tab === "logs" ? (
            <LogsTab />
          ) : tab === "ai" ? (
            <AiSettingsTab />
          ) : tab === "accounts" ? (
            <ConnectorsTab />
          ) : tab === "types" ? (
            <TypesSettingsTab />
          ) : null}
        </section>
      </main>
    </div>
  );
}
