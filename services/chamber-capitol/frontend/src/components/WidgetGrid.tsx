import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  useCapitolSettings,
  ChamberMark,
  fetchRegistry,
  PAGE_SCROLL_TOP_MESSAGE,
  type PageScrollTopMessage,
} from "@congress/congress-ui";
import { fetchSettings } from "@/lib/api";

export function WidgetGrid() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["congress", "registry"],
    queryFn: fetchRegistry,
  });
  // darkMode is Congress-owned (needed everywhere, including here for the
  // widget iframes' ?theme= param); hiddenWidgets is this Chamber's own
  // local preference (see lib/api.ts's fetchSettings) - two different
  // settings scopes, deliberately not the same endpoint anymore.
  const { data: congressSettings } = useCapitolSettings();
  const { data: ownSettings } = useQuery({ queryKey: ["capitol", "settings"], queryFn: fetchSettings });
  // Told explicitly rather than left to fetch its own copy - see
  // useAppliedTheme's forcedThemeFromUrl for why.
  const theme = congressSettings?.darkMode ? "dark" : "light";
  const hiddenWidgets = ownSettings?.hiddenWidgets ?? [];
  // Capitol itself is a registered Chamber now (it registers to get onto
  // Congress's registry like everyone else), but it has no widget of its
  // own (manifest.ts's routes.widget is "") - showing itself in its own
  // grid would just be a broken iframe pointing nowhere.
  const visibleData = data?.filter((chamber) => chamber.name !== "capitol" && !hiddenWidgets.includes(chamber.name));

  const iframesRef = useRef(new Map<string, HTMLIFrameElement>());

  // Each widget iframe is a separate browsing context with no visibility
  // into this page's own scroll position (see useWidgetPullBridge) - tell
  // every live one whenever that crosses the top boundary, so a pull
  // started over a widget only ever gets hijacked into the search/refresh
  // gesture while the page is actually at its top.
  useEffect(() => {
    function broadcastScrollTop() {
      const message: PageScrollTopMessage = { type: PAGE_SCROLL_TOP_MESSAGE, atTop: window.scrollY === 0 };
      for (const iframe of iframesRef.current.values()) {
        iframe.contentWindow?.postMessage(message, "*");
      }
    }
    broadcastScrollTop();
    window.addEventListener("scroll", broadcastScrollTop, { passive: true });
    return () => window.removeEventListener("scroll", broadcastScrollTop);
  }, [visibleData]);

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Chambers</h2>

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && (
        <p className="font-mono text-sm text-alert">Failed to reach Congress's registry.</p>
      )}
      {!isLoading && !isError && data?.length === 0 && (
        <div className="border-y border-dust px-1 py-3 font-mono text-sm text-dust">
          — No Chambers registered —
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && visibleData?.length === 0 && (
        <div className="border-y border-dust px-1 py-3 font-mono text-sm text-dust">
          — All Chambers hidden — enable them in Settings —
        </div>
      )}

      {!isLoading && !isError && visibleData && visibleData.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {visibleData.map((chamber) => {
            const active = chamber.status === "active";
            return (
              <div
                key={chamber.name}
                className={`relative flex h-64 flex-col overflow-hidden border border-dust ${
                  active ? "bg-parchment" : "bg-ink/[0.06]"
                }`}
              >
                <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-dust px-3 py-2">
                  <ChamberMark
                    name={chamber.name}
                    className={`h-5 w-5 ${active ? "text-ink" : "text-dust"}`}
                  />
                  {active ? (
                    <Link
                      to={chamber.routes.home}
                      className="font-display text-base text-ink hover:text-accent"
                    >
                      {chamber.displayName}
                    </Link>
                  ) : (
                    <span className="font-display text-base text-dust">{chamber.displayName}</span>
                  )}
                </div>

                <div className="relative z-10 min-h-0 flex-1">
                  {active && (
                    <iframe
                      ref={(el) => {
                        if (el) iframesRef.current.set(chamber.name, el);
                        else iframesRef.current.delete(chamber.name);
                      }}
                      src={`${chamber.routes.widget}?theme=${theme}`}
                      title={`${chamber.displayName} widget`}
                      className="h-full w-full border-0"
                      onLoad={(e) =>
                        e.currentTarget.contentWindow?.postMessage(
                          { type: PAGE_SCROLL_TOP_MESSAGE, atTop: window.scrollY === 0 } satisfies PageScrollTopMessage,
                          "*"
                        )
                      }
                    />
                  )}
                </div>

                {!active && (
                  <>
                    <span className="sr-only">{chamber.displayName} is unavailable</span>
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-20"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(135deg, transparent, transparent 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 7px, color-mix(in srgb, var(--color-ink) 12%, transparent) 8px)",
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
