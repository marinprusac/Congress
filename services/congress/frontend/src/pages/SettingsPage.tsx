import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ChamberHeader,
  ChamberMark,
  useAppliedTheme,
  useCapitolSettings,
  capitolSettingsQueryKey,
  updateCapitolSettings,
  fetchRegistry,
  loadRemoteModule,
} from "@congress/congress-ui";
import { SignOutControl } from "@/components/LoginGate";

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

interface ChamberSettingsPanel {
  name: string;
  displayName: string;
}

// Resolves every active Chamber's own `settings` export (see RemoteModule)
// out of that Chamber's own remote-entry.js, fetching it on demand the same
// way ChamberHost does for a full Chamber visit - opening Settings is itself
// the trigger, there's no separate eager preload to lean on. A Chamber with
// nothing configurable, or one that fails to load, is simply excluded from
// the tab strip rather than shown broken. Only
// serializable {name, displayName} pairs go into this query's data - Congress
// wraps every query in PersistedQueryProvider, which round-trips cached data
// through IndexedDB via JSON, and a live component reference doesn't survive
// that (silently becomes undefined on rehydrate, so a tab could crash the
// whole shell days after this query last actually ran). The Component itself
// is resolved separately below, the same in-memory-only way Capitol's canvas
// resolves a widget (see getWidgetComponent in that Chamber's own
// widgetComponent.ts).
function useChamberSettingsPanels(chambers: { name: string; displayName: string }[]) {
  const key = chambers.map((c) => c.name).join(",");
  return useQuery({
    queryKey: ["settings-panels", key],
    queryFn: async (): Promise<ChamberSettingsPanel[]> => {
      const resolved = await Promise.all(
        chambers.map(async (c) => {
          try {
            const mod = await loadRemoteModule(c.name);
            return mod.settings ? { name: c.name, displayName: c.displayName } : null;
          } catch {
            return null;
          }
        })
      );
      return resolved.filter((panel): panel is ChamberSettingsPanel => panel !== null);
    },
    enabled: chambers.length > 0,
  });
}

// Mirrors getWidgetComponent's own pattern (chamber-capitol's
// widgetComponent.ts) - a plain in-memory Map, never react-query, so the
// resolved component itself never touches the persisted cache above.
const settingsComponentCache = new Map<string, LazyExoticComponent<ComponentType>>();

function getSettingsComponent(chamberName: string): LazyExoticComponent<ComponentType> {
  let component = settingsComponentCache.get(chamberName);
  if (!component) {
    component = lazy(async () => {
      const mod = await loadRemoteModule(chamberName);
      if (!mod.settings) throw new Error(`Chamber "${chamberName}" has no settings panel`);
      return { default: mod.settings };
    });
    settingsComponentCache.set(chamberName, component);
  }
  return component;
}

// Isolates a broken settings panel to its own tab instead of letting an
// uncaught render error (a genuine bug in that Chamber's own code, same
// class of failure ChamberHost's own ChamberErrorBoundary guards against)
// propagate past this root's own createRoot() and blank the entire shell -
// confirmed by testing, same as that boundary's own comment.
interface SettingsPanelErrorBoundaryState {
  failed: boolean;
}
class SettingsPanelErrorBoundary extends Component<{ chamberName: string; children: ReactNode }, SettingsPanelErrorBoundaryState> {
  state: SettingsPanelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <p className="font-mono text-sm text-alert">{this.props.chamberName}'s settings failed to load.</p>;
    }
    return this.props.children;
  }
}

// Congress-owned settings (dark mode) plus sign-out - previously exposed
// through Capitol's own Settings page even though it's not Capitol's (see
// CapitolSettings' own comment in shared-types), now the one default tab
// here instead, alongside every other Chamber's own.
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

// Unified Settings - one page, reached from NavPanel's single Settings
// entry point instead of a gear icon on every Chamber's own header. Every
// Chamber's own settings content (previously each Chamber's own routed
// /settings page) is mounted here as one tab-category, resolved from that
// Chamber's own remote entry the same way Capitol's canvas resolves widgets
// - see useChamberSettingsPanels above and RemoteModule's `settings` field.
// NavPanel itself isn't mounted here anymore - App.tsx now mounts one
// persistent NavPanel outside this route's own tree (see App.tsx's own
// comment), covering Settings the same as every Chamber route.
export function SettingsPage() {
  useAppliedTheme();

  // NavPanel's Settings entry carries whichever Chamber it was clicked from
  // as "?from=" (see NavPanel's own settingsTo) - opening straight to that
  // Chamber's own tab is much more useful than always landing on General,
  // which is what a bare "/settings" (already on Settings, or a stale/typed
  // link with no "from") still falls back to.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("from");

  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const activeChambers = (registry ?? []).filter((c) => c.status === "active");
  const { data: panels } = useChamberSettingsPanels(
    activeChambers.map((c) => ({ name: c.name, displayName: c.displayName }))
  );

  const [tab, setTab] = useState<string>(requestedTab ?? "general");
  // The requested Chamber might not actually have a settings panel (or
  // might not even be a real/active Chamber) - only knowable once `panels`
  // itself has resolved, so this can't just be the initial state above.
  // Once it's known one way or the other, a still-missing tab falls back to
  // General rather than leaving the page stuck on a tab strip entry that
  // will never appear (see the fallback render below for the loading gap
  // in between).
  useEffect(() => {
    if (!panels || tab === "general") return;
    if (!panels.some((panel) => panel.name === tab)) setTab("general");
  }, [panels, tab]);

  const activePanel = (panels ?? []).find((p) => p.name === tab);
  const ActivePanelComponent = activePanel ? getSettingsComponent(activePanel.name) : null;

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={<SettingsGearIcon />} title="Settings" />
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
          {(panels ?? []).map((panel) => (
            <button
              key={panel.name}
              type="button"
              role="tab"
              aria-selected={tab === panel.name}
              className={tab === panel.name ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab(panel.name)}
            >
              <ChamberMark name={panel.name} className="settings-tab-icon" />
              {panel.displayName}
            </button>
          ))}
        </div>
        <section className="settings-tab-panel">
          {tab === "general" ? (
            <GeneralTab />
          ) : ActivePanelComponent && activePanel ? (
            <SettingsPanelErrorBoundary key={activePanel.name} chamberName={activePanel.displayName}>
              <Suspense fallback={<p className="font-mono text-sm text-dust">Loading —</p>}>
                <ActivePanelComponent />
              </Suspense>
            </SettingsPanelErrorBoundary>
          ) : (
            // Either the panel list hasn't resolved yet, or it just has and
            // the effect above is about to redirect this tab to General -
            // either way there's nothing to render for `tab` yet.
            <p className="font-mono text-sm text-dust">Loading —</p>
          )}
        </section>
      </main>
    </div>
  );
}
