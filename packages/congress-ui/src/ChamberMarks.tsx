import { useSyncExternalStore, type ReactElement, type SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">;

const GROUP_TRANSFORM = "translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)";

// Capitol's own mark: a cluster of circles orbiting a larger one — the hub
// other Chambers register and gather around. Hardcoded, unlike every
// Chamber's own mark (see below) - Capitol isn't a pluggable module, it's
// the one fixed hub, so there's no independence concern with its icon
// living in the shared package it already owns the frontend of.
export function CapitolMark(props: IconProps) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform={GROUP_TRANSFORM}>
      <path d="M 73.815 46.353 c 0.067 -0.81 0.11 -1.627 0.11 -2.455 c 0 -16.255 -13.225 -29.48 -29.48 -29.48 c -2.232 0 -4.403 0.258 -6.494 0.73 C 36.469 6.493 29.016 0.017 19.994 0.017 c -10.069 0 -18.261 8.192 -18.261 18.262 c 0 8.581 6.111 15.958 14.295 17.793 c -0.688 2.494 -1.063 5.117 -1.063 7.827 c 0 16.077 12.938 29.181 28.949 29.466 C 46.564 83.095 55.458 90 65.684 90 c 12.453 0 22.584 -10.131 22.584 -22.584 C 88.268 57.955 82.524 49.693 73.815 46.353 z M 17.344 32.281 c -6.617 -1.255 -11.611 -7.144 -11.611 -14.002 c 0 -7.864 6.397 -14.262 14.261 -14.262 c 7.202 0 13.14 5.282 14.105 12.271 c -0.306 0.115 -0.606 0.243 -0.907 0.368 c -0.086 0.035 -0.173 0.068 -0.258 0.104 c -0.337 0.143 -0.668 0.297 -0.999 0.452 c -0.112 0.053 -0.226 0.103 -0.337 0.157 c -0.302 0.147 -0.598 0.302 -0.894 0.458 c -0.137 0.073 -0.276 0.144 -0.412 0.218 c -0.269 0.148 -0.533 0.303 -0.797 0.459 c -0.159 0.094 -0.319 0.187 -0.476 0.284 c -0.24 0.148 -0.475 0.301 -0.71 0.456 c -0.175 0.115 -0.349 0.229 -0.522 0.348 c -0.216 0.149 -0.429 0.302 -0.642 0.457 c -0.183 0.133 -0.366 0.267 -0.546 0.405 c -0.199 0.152 -0.395 0.307 -0.589 0.463 c -0.184 0.148 -0.367 0.297 -0.547 0.449 c -0.188 0.158 -0.373 0.32 -0.557 0.483 c -0.177 0.157 -0.352 0.316 -0.525 0.477 c -0.182 0.17 -0.362 0.341 -0.54 0.515 c -0.163 0.16 -0.324 0.322 -0.483 0.485 c -0.182 0.187 -0.362 0.375 -0.54 0.566 c -0.143 0.155 -0.284 0.312 -0.424 0.47 c -0.186 0.209 -0.369 0.419 -0.549 0.634 c -0.12 0.143 -0.237 0.288 -0.354 0.434 c -0.192 0.238 -0.382 0.476 -0.566 0.72 c -0.092 0.122 -0.182 0.246 -0.272 0.37 c -0.201 0.274 -0.399 0.549 -0.591 0.83 c -0.061 0.09 -0.12 0.182 -0.181 0.273 c -0.212 0.318 -0.42 0.639 -0.62 0.966 c -0.03 0.048 -0.057 0.098 -0.087 0.146 C 18.489 29.872 17.872 31.053 17.344 32.281 z M 18.965 43.899 c 0 -3.888 0.879 -7.574 2.443 -10.875 c 0.035 -0.073 0.068 -0.147 0.103 -0.22 c 0.144 -0.296 0.295 -0.587 0.449 -0.876 c 0.054 -0.101 0.108 -0.202 0.164 -0.303 c 0.151 -0.274 0.307 -0.545 0.468 -0.812 c 0.067 -0.111 0.136 -0.221 0.205 -0.332 c 0.161 -0.258 0.323 -0.516 0.492 -0.768 c 0.073 -0.108 0.15 -0.213 0.224 -0.32 c 0.342 -0.492 0.701 -0.972 1.076 -1.438 c 0.07 -0.087 0.136 -0.177 0.207 -0.263 c 0.146 -0.177 0.299 -0.347 0.45 -0.519 c 0.147 -0.168 0.293 -0.337 0.444 -0.502 c 0.148 -0.161 0.3 -0.317 0.452 -0.474 c 0.164 -0.169 0.328 -0.337 0.496 -0.501 c 0.152 -0.148 0.305 -0.295 0.461 -0.439 c 0.178 -0.165 0.358 -0.327 0.54 -0.487 c 0.156 -0.137 0.311 -0.274 0.469 -0.407 c 0.194 -0.162 0.392 -0.319 0.591 -0.475 c 0.155 -0.122 0.308 -0.248 0.466 -0.367 c 0.255 -0.192 0.517 -0.375 0.779 -0.558 c 0.265 -0.184 0.535 -0.362 0.807 -0.536 c 0.187 -0.12 0.372 -0.241 0.562 -0.356 c 0.214 -0.129 0.431 -0.251 0.649 -0.374 c 0.167 -0.095 0.335 -0.19 0.505 -0.28 c 0.231 -0.124 0.465 -0.243 0.7 -0.359 c 0.159 -0.079 0.318 -0.156 0.479 -0.231 c 0.246 -0.116 0.494 -0.229 0.745 -0.337 c 0.153 -0.066 0.308 -0.128 0.462 -0.191 c 0.26 -0.106 0.52 -0.212 0.785 -0.31 c 0.145 -0.054 0.293 -0.101 0.44 -0.152 c 2.622 -0.914 5.435 -1.417 8.365 -1.417 c 14.049 0 25.48 11.431 25.48 25.48 c 0 1.209 -0.09 2.397 -0.254 3.562 c -0.1 0.714 -0.233 1.415 -0.39 2.107 c -0.02 0.088 -0.04 0.175 -0.061 0.263 c -0.149 0.629 -0.323 1.247 -0.517 1.856 c -0.054 0.167 -0.112 0.333 -0.169 0.499 c -0.166 0.486 -0.347 0.964 -0.541 1.436 c -0.127 0.305 -0.261 0.606 -0.399 0.906 c -0.118 0.259 -0.242 0.514 -0.369 0.767 c -0.28 0.558 -0.578 1.105 -0.897 1.638 c -0.045 0.076 -0.09 0.153 -0.136 0.229 c -1.909 3.119 -4.469 5.798 -7.491 7.845 c -0.009 0.006 -0.018 0.013 -0.027 0.019 c -0.559 0.378 -1.138 0.729 -1.727 1.062 c -0.129 0.072 -0.254 0.15 -0.384 0.22 c -0.284 0.154 -0.573 0.299 -0.864 0.443 c -0.415 0.204 -0.833 0.402 -1.261 0.584 c -0.214 0.091 -0.432 0.175 -0.648 0.261 c -0.491 0.193 -0.987 0.376 -1.492 0.539 c -0.089 0.029 -0.176 0.062 -0.266 0.09 c -0.647 0.201 -1.305 0.373 -1.973 0.523 c -0.067 0.015 -0.133 0.032 -0.2 0.046 c -0.692 0.149 -1.395 0.271 -2.106 0.363 c -0.034 0.004 -0.069 0.009 -0.103 0.013 c -0.738 0.092 -1.484 0.155 -2.239 0.183 c -0.003 0 -0.005 0.001 -0.007 0.001 c -0.318 0.012 -0.637 0.024 -0.958 0.024 C 30.395 69.379 18.965 57.948 18.965 43.899 z M 65.684 86 c -8.116 0 -15.222 -5.282 -17.672 -12.842 c 0.028 -0.003 0.056 -0.01 0.084 -0.013 c 1.432 -0.178 2.831 -0.457 4.192 -0.833 c 0.168 -0.046 0.335 -0.094 0.502 -0.143 c 0.57 -0.169 1.135 -0.349 1.69 -0.55 c 0.252 -0.091 0.498 -0.192 0.746 -0.29 c 0.338 -0.133 0.674 -0.271 1.007 -0.416 c 0.32 -0.139 0.638 -0.281 0.952 -0.431 c 0.097 -0.047 0.192 -0.098 0.288 -0.146 c 0.751 -0.369 1.482 -0.77 2.196 -1.2 c 0.032 -0.02 0.065 -0.039 0.097 -0.059 c 4.408 -2.679 8.056 -6.481 10.546 -11.048 c 0.04 -0.072 0.078 -0.146 0.118 -0.218 c 0.315 -0.59 0.61 -1.191 0.886 -1.805 c 0.118 -0.261 0.237 -0.521 0.347 -0.785 c 0.115 -0.279 0.226 -0.559 0.333 -0.842 c 0.19 -0.498 0.369 -1.001 0.532 -1.512 c 0.038 -0.119 0.077 -0.237 0.113 -0.357 c 0.192 -0.629 0.359 -1.268 0.509 -1.914 c 0.014 -0.06 0.034 -0.118 0.047 -0.178 c 6.705 2.938 11.071 9.517 11.071 17.001 C 84.268 77.663 75.931 86 65.684 86 z" />
      <path d="M 79.852 16.832 c 4.641 0 8.416 -3.775 8.416 -8.416 S 84.492 0 79.852 0 s -8.416 3.775 -8.416 8.416 S 75.211 16.832 79.852 16.832 z M 79.852 4 c 2.435 0 4.416 1.981 4.416 4.416 s -1.981 4.416 -4.416 4.416 s -4.416 -1.981 -4.416 -4.416 S 77.417 4 79.852 4 z" />
      <path d="M 12.679 68.108 c -6.036 0 -10.946 4.91 -10.946 10.945 C 1.733 85.09 6.643 90 12.679 90 s 10.946 -4.91 10.946 -10.946 C 23.625 73.019 18.714 68.108 12.679 68.108 z M 12.679 86 c -3.83 0 -6.946 -3.116 -6.946 -6.946 s 3.116 -6.945 6.946 -6.945 s 6.946 3.115 6.946 6.945 S 16.509 86 12.679 86 z" />
      </g>
    </svg>
  );
}

// Fallback for a Chamber that's offline, unregistered, or never shipped its
// own icon (frontend/public/icons/mark.svg - see fetchChamberIconMarkup
// below). Always renders something, so nothing ever needs to hardcode a
// per-Chamber SVG in this shared package - see docs/creating-a-chamber.md.
function DefaultChamberMark(props: IconProps) {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" {...props}>
      <g transform={GROUP_TRANSFORM}>
      <path d="M 89.414 43.586 l -43 -43 c -0.781 -0.781 -2.048 -0.781 -2.828 0 l -43 43 c -0.781 0.781 -0.781 2.047 0 2.828 l 43 43 C 43.976 89.805 44.488 90 45 90 s 1.023 -0.195 1.414 -0.586 l 43 -43 C 90.195 45.633 90.195 44.367 89.414 43.586 z M 45 4.829 l 18.616 18.616 c -10.646 9.253 -26.588 9.253 -37.233 0 L 45 4.829 z M 58.575 31.425 c -3.952 8.589 -3.951 18.562 0 27.151 c -8.588 -3.951 -18.562 -3.952 -27.151 -0.001 c 3.952 -8.589 3.952 -18.562 0 -27.15 c 4.294 1.976 8.934 2.966 13.575 2.966 C 49.641 34.391 54.281 33.401 58.575 31.425 z M 23.445 26.384 c 9.253 10.646 9.253 26.587 0 37.233 L 4.829 45 L 23.445 26.384 z M 45 85.172 L 26.384 66.555 c 10.646 -9.252 26.587 -9.252 37.233 0 L 45 85.172 z M 66.555 63.617 c -9.253 -10.646 -9.253 -26.587 0 -37.233 L 85.172 45 L 66.555 63.617 z" />
      </g>
    </svg>
  );
}

// --- Fetched-from-the-owning-Chamber icon system -----------------------
//
// Every Chamber independence rule this repo enforces (see CLAUDE.md) means
// a shared package can never hold a per-Chamber lookup table - a new
// Chamber must be able to get its own icon rendered everywhere without
// anyone editing congress-ui. So a Chamber's icon is just another static
// asset it serves itself (frontend/public/icons/mark.svg, built into
// dist/ alongside icon-192.png), fetched at runtime through Capitol's
// generic, registry-driven proxy (GET /congress/chambers/:name/icon - see
// services/congress/src/gateway.ts's proxyToChamberIcon), and inlined as
// real SVG markup so it can still be recolored via `currentColor` and
// respond to hover/theme like every mark always has.
//
// Module-scoped cache + pub/sub, read through useSyncExternalStore: a
// given Chamber's icon is fetched at most once per page load, and every
// consumer (nav picker, exhibit chips, homepage tiles, ...) re-renders
// together the moment it resolves, however many of them are mounted.
type IconCacheEntry = string | null; // null = unavailable (offline / no icon shipped / fetch failed)

const iconCache = new Map<string, IconCacheEntry>();
const iconListeners = new Map<string, Set<() => void>>();

function notify(chamber: string): void {
  for (const listener of iconListeners.get(chamber) ?? []) listener();
}

// Strips the couple of tags/attributes that would matter if this markup
// ever came from an untrusted source. Not a hard security boundary - a
// Chamber's own frontend bundle already runs with full DOM access the
// moment Capitol's shell imports it (see ChamberHost/remote-entry.js in
// CLAUDE.md's shell-hosting section) - just hygiene for what's ultimately
// meant to be a plain, static <svg>.
function sanitizeIconMarkup(svg: string): IconCacheEntry {
  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return null;
  return trimmed.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
}

function ensureIconFetch(chamber: string): void {
  if (iconCache.has(chamber)) return;
  iconCache.set(chamber, null); // claim the slot immediately so concurrent renders don't double-fetch
  fetch(`/congress/chambers/${encodeURIComponent(chamber)}/icon`)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
    .then((svg) => {
      iconCache.set(chamber, sanitizeIconMarkup(svg));
      notify(chamber);
    })
    .catch(() => {
      // Already null from the claim above - nothing to update, and
      // DefaultChamberMark is already what's showing.
    });
}

function subscribeToIcon(chamber: string, onChange: () => void): () => void {
  let set = iconListeners.get(chamber);
  if (!set) {
    set = new Set();
    iconListeners.set(chamber, set);
  }
  set.add(onChange);
  return () => set.delete(onChange);
}

function useChamberIconMarkup(chamber: string): string | null {
  ensureIconFetch(chamber);
  return useSyncExternalStore(
    (onChange) => subscribeToIcon(chamber, onChange),
    () => iconCache.get(chamber) ?? null
  );
}

// Puts `className` directly on the fetched markup's own root <svg> tag -
// the same element every caller's className (sizing utilities, `text-ink`
// for currentColor, ...) has always targeted, back when marks were inline
// components spreading {...props} onto their own <svg>. Only className:
// it's the one prop any call site in this repo actually passes (confirmed
// across every ChamberMark/getChamberIcon usage) - no need to support the
// rest of IconProps for markup nobody threads it through.
function withClassName(svg: string, className: string | undefined): string {
  if (!className) return svg;
  return svg.replace(/^<svg(\s|>)/, `<svg class="${className}"$1`);
}

function FetchedMark({ chamber, ...props }: IconProps & { chamber: string }) {
  const markup = useChamberIconMarkup(chamber);
  if (!markup) return <DefaultChamberMark {...props} />;
  return (
    // display:contents - this element exists only because
    // dangerouslySetInnerHTML needs a host node; it never generates its own
    // box, so it's invisible to sizing/layout and the injected <svg> above
    // behaves exactly as if it sat directly where this span is.
    <span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: withClassName(markup, props.className) }} />
  );
}

// Always renders something - an unreachable/iconless Chamber falls back to
// DefaultChamberMark, same as before. Use this where a guaranteed icon is
// wanted (e.g. next to a known Chamber's name in a header).
export function ChamberMark({ name, ...props }: IconProps & { name: string }): ReactElement {
  return <FetchedMark chamber={name} {...props} />;
}

// Same rendering as ChamberMark - kept as a second export because callers
// pass it around as a `renderIcon: (chamber: string) => ReactNode` prop
// (ExhibitChip, ExhibitTextarea's "[[" picker, ...), which reads more
// naturally as a function than as `<ChamberMark name={chamber} />` inline.
export function getChamberIcon(chamber: string, props?: IconProps): ReactElement {
  return <FetchedMark chamber={chamber} {...props} />;
}
