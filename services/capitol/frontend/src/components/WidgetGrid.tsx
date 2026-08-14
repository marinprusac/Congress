import { useQuery } from "@tanstack/react-query";
import { useCapitolSettings } from "@congress/exhibit-ui";
import { fetchRegistry } from "@/lib/api";
import { ChamberMark } from "@/components/icons";

export function WidgetGrid() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["capitol", "registry"],
    queryFn: fetchRegistry,
  });
  const { data: settings } = useCapitolSettings();
  // Told explicitly rather than left to fetch its own copy - see
  // useAppliedTheme's forcedThemeFromUrl for why.
  const theme = settings?.darkMode ? "dark" : "light";

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl text-ink">Chambers</h2>

      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && (
        <p className="font-mono text-sm text-alert">Failed to reach Capitol's registry.</p>
      )}
      {!isLoading && !isError && data?.length === 0 && (
        <div className="border-y border-dust px-1 py-3 font-mono text-sm text-dust">
          — No Chambers registered —
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {data.map((chamber) => {
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
                    <a
                      href={chamber.routes.home}
                      className="font-display text-base text-ink hover:text-accent"
                    >
                      {chamber.displayName}
                    </a>
                  ) : (
                    <span className="font-display text-base text-dust">{chamber.displayName}</span>
                  )}
                </div>

                <div className="relative z-10 min-h-0 flex-1">
                  {active && (
                    <iframe
                      src={`${chamber.routes.widget}?theme=${theme}`}
                      title={`${chamber.displayName} widget`}
                      className="h-full w-full border-0"
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
