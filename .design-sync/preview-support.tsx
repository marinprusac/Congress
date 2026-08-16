import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Design-sync preview support only - never imported by the real app.
// Every congress-ui component that talks to Capitol does so via plain
// `fetch()` against relative "/capitol/*" and "/api/*" paths, since in the
// real app that's proxied to a live backend. An isolated Claude Design
// preview has no backend to hit, so this installs a realistic canned
// response for every endpoint these components call, matching
// @congress/shared-types response shapes exactly. Installed once at module
// load (before any component's effects run), not inside a component, so
// the very first render already has data instead of a loading flash.

const REGISTRY = [
  {
    name: "notes",
    displayName: "Notes",
    version: "0.1.0",
    routes: { home: "/notes", settings: "/notes/settings", widget: "/notes/widget" },
    apiBase: "https://congress.example/api",
    mcpUrl: "https://congress.example/mcp",
    healthUrl: "https://congress.example/health",
    status: "active",
    registeredAt: "2026-06-01T12:00:00.000Z",
    lastHeartbeatAt: "2026-08-15T09:00:00.000Z",
  },
  {
    name: "calendar",
    displayName: "Calendar",
    version: "0.1.0",
    routes: { home: "/calendar", settings: "/calendar/settings", widget: "/calendar/widget" },
    apiBase: "https://congress.example/api",
    mcpUrl: "https://congress.example/mcp",
    healthUrl: "https://congress.example/health",
    status: "active",
    registeredAt: "2026-06-01T12:00:00.000Z",
    lastHeartbeatAt: "2026-08-15T09:00:00.000Z",
  },
  {
    name: "documents",
    displayName: "Documents",
    version: "0.1.0",
    routes: { home: "/documents", settings: "/documents/settings", widget: "/documents/widget" },
    apiBase: "https://congress.example/api",
    mcpUrl: "https://congress.example/mcp",
    healthUrl: "https://congress.example/health",
    status: "active",
    registeredAt: "2026-06-01T12:00:00.000Z",
    lastHeartbeatAt: "2026-08-15T09:00:00.000Z",
  },
  {
    name: "tasks",
    displayName: "Tasks",
    version: "0.1.0",
    routes: { home: "/tasks", settings: "/tasks/settings", widget: "/tasks/widget" },
    apiBase: "https://congress.example/api",
    mcpUrl: "https://congress.example/mcp",
    healthUrl: "https://congress.example/health",
    status: "active",
    registeredAt: "2026-06-01T12:00:00.000Z",
    lastHeartbeatAt: "2026-08-15T09:00:00.000Z",
  },
];

const SEARCH_RESULTS = [
  { id: "note-9", type: "note", name: "Congress Development", url: "/notes/n/9", chamber: "notes" },
  { id: "note-5", type: "note", name: "Needed Fixes", url: "/notes/n/5", chamber: "notes" },
  { id: "task-1", type: "task", name: "Ship the Tasks Chamber", url: "/tasks/t/1", chamber: "tasks" },
  { id: "document-1", type: "document", name: "Congress Chamber Icons.zip", url: "/documents/d/1", chamber: "documents" },
  { id: "event-3", type: "event", name: "Team Sync — Thursday", url: "/calendar/e/3", chamber: "calendar" },
];

const RESOLVE_RESULTS = [
  { id: "note-9", chamber: "notes", name: "Congress Development", url: "/notes/n/9" },
  { id: "task-1", chamber: "tasks", name: "Ship the Tasks Chamber", url: "/tasks/t/1" },
  { id: "note-99", chamber: "notes", deleted: true },
  { id: "document-4", chamber: "documents", unavailable: true },
];

const SHARE_SUMMARY = {
  token: "8b6b7e2a-2f3e-4b1a-9c3d-1a2b3c4d5e6f",
  rootId: "note-9",
  rootChamber: "notes",
  maxDepth: 2,
  permission: "view",
  label: "For Claude — architecture",
  createdAt: "2026-08-01T10:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  lastAccessedAt: "2026-08-14T18:30:00.000Z",
};

const SHARING_ENTRIES = [
  { token: SHARE_SUMMARY.token, label: SHARE_SUMMARY.label, permission: "view", direct: true },
];

const NOTIFICATIONS = [
  {
    id: 3,
    chamber: "tasks",
    title: "Ship the Tasks Chamber",
    body: "Due today at 5:00 PM",
    chamberUrl: "/t/1",
    createdAt: "2026-08-16T08:15:00.000Z",
    readAt: null,
  },
  {
    id: 2,
    chamber: "calendar",
    title: "Team Sync — Thursday",
    body: "Starting in 15 minutes",
    chamberUrl: "/e/3",
    createdAt: "2026-08-16T07:45:00.000Z",
    readAt: null,
  },
  {
    id: 1,
    chamber: "notes",
    title: "Congress Development",
    body: null,
    chamberUrl: "/n/9",
    createdAt: "2026-08-15T18:30:00.000Z",
    readAt: "2026-08-15T19:00:00.000Z",
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function svgResponse(markup: string): Response {
  return new Response(markup, { status: 200, headers: { "Content-Type": "image/svg+xml" } });
}

// Each Chamber's own icons/mark.svg (ChamberMark fetches these at runtime
// via /capitol/chambers/:name/icon rather than any lookup table living in
// this shared package - see ChamberMarks.tsx's "Fetched-from-the-owning-
// Chamber icon system" comment). Without this mock every named chamber
// falls through to DefaultChamberMark and every preview cell looks
// identical - copied verbatim from each service's frontend/public/icons/mark.svg.
const CHAMBER_ICONS: Record<string, string> = {
  notes: `<svg viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
    <path d="M 89.414 43.586 L 63.425 17.597 c -0.781 -0.781 -2.047 -0.781 -2.828 0 L 50.198 27.995 c -5.12 -6.672 -13.169 -10.984 -22.21 -10.984 C 12.556 17.011 0 29.567 0 45 c 0 15.434 12.556 27.989 27.989 27.989 c 9.041 0 17.089 -4.313 22.21 -10.984 l 10.398 10.398 c 0.375 0.375 0.884 0.586 1.414 0.586 s 1.039 -0.211 1.414 -0.586 l 25.989 -25.989 C 89.789 46.039 90 45.53 90 45 S 89.789 43.961 89.414 43.586 z M 27.989 68.989 C 14.761 68.989 4 58.228 4 45 s 10.761 -23.989 23.989 -23.989 c 7.939 0 14.986 3.879 19.355 9.839 L 34.608 43.586 c -0.781 0.781 -0.781 2.047 0 2.828 L 47.344 59.15 C 42.975 65.11 35.928 68.989 27.989 68.989 z M 51.978 45 c 0 3.817 -0.901 7.427 -2.494 10.634 L 38.851 45 l 10.633 -10.633 C 51.077 37.574 51.978 41.183 51.978 45 z M 62.011 68.161 l -9.568 -9.568 c 2.248 -4.028 3.534 -8.662 3.534 -13.593 c 0 -4.931 -1.286 -9.565 -3.534 -13.593 l 9.567 -9.567 L 85.172 45 L 62.011 68.161 z" />
  </g>
</svg>`,
  calendar: `<svg viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
    <path d="M 88 0 H 2 C 0.896 0 0 0.896 0 2 v 71 c 0 1.104 0.896 2 2 2 h 71 c 1.104 0 2 -0.896 2 -2 V 17 c 0 -1.104 -0.896 -2 -2 -2 H 17 c -1.104 0 -2 0.896 -2 2 v 41 c 0 1.104 0.896 2 2 2 h 41 c 1.104 0 2 -0.896 2 -2 V 32 c 0 -1.104 -0.896 -2 -2 -2 H 32 c -1.104 0 -2 0.896 -2 2 v 13 c 0 1.104 0.896 2 2 2 s 2 -0.896 2 -2 V 34 h 22 v 22 H 19 V 19 h 52 v 52 H 4 V 4 h 82 v 82 H 2 c -1.104 0 -2 0.896 -2 2 s 0.896 2 2 2 h 86 c 1.104 0 2 -0.896 2 -2 V 2 C 90 0.896 89.104 0 88 0 z" />
  </g>
</svg>`,
  documents: `<svg viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
    <path d="M 30.459 4.618 C 15.869 4.618 4 16.49 4 31.083 c 0 1.104 -0.896 2 -2 2 s -2 -0.896 -2 -2 C 0 14.285 13.664 0.618 30.459 0.618 c 16.794 0 30.458 13.667 30.458 30.465 v 25.751 c 13.661 -1.026 24.465 -12.459 24.465 -26.375 C 85.382 15.869 73.51 4 58.917 4 c -1.104 0 -2 -0.896 -2 -2 s 0.896 -2 2 -2 c 16.798 0 30.465 13.664 30.465 30.458 c 0 16.794 -13.667 30.458 -30.465 30.458 H 33.166 c 1.026 13.661 12.459 24.465 26.375 24.465 C 74.131 85.382 86 73.51 86 58.917 c 0 -1.104 0.896 -2 2 -2 s 2 0.896 2 2 c 0 16.799 -13.664 30.465 -30.458 30.465 c -16.794 0 -30.458 -13.666 -30.458 -30.465 V 33.166 C 15.422 34.193 4.618 45.625 4.618 59.541 C 4.618 74.131 16.49 86 31.083 86 c 1.104 0 2 0.896 2 2 s -0.896 2 -2 2 C 14.284 90 0.618 76.336 0.618 59.541 c 0 -16.794 13.666 -30.458 30.465 -30.458 h 25.751 C 55.807 15.422 44.375 4.618 30.459 4.618 z M 33.083 56.917 h 23.834 V 33.083 H 33.083 V 56.917 z" />
  </g>
</svg>`,
  tasks: `<svg viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
    <path d="M 72.812 87.798 L 45 73.176 L 17.188 87.798 L 22.5 56.829 L 0 34.896 l 31.094 -4.518 L 45 2.202 l 13.906 28.177 L 90 34.896 L 67.5 56.829 L 72.812 87.798 z M 45 68.735 l 22.592 11.877 l -4.315 -25.156 l 18.278 -17.816 l -25.258 -3.669 L 45 11.083 L 33.704 33.971 L 8.446 37.641 l 18.277 17.816 l -4.315 25.156 L 45 68.735 z M 59.52 69.502 L 45 61.869 l -14.52 7.633 l 2.773 -16.166 L 21.507 41.884 l 16.233 -2.358 L 45 24.816 l 7.26 14.71 l 16.234 2.358 L 56.747 53.336 L 59.52 69.502 z M 29.953 44.629 l 7.523 7.334 L 35.7 62.317 l 9.3 -4.889 l 9.3 4.889 l -1.777 -10.354 l 7.525 -7.334 l -10.398 -1.51 L 45 33.697 l -4.65 9.422 L 29.953 44.629 z" />
    <polygon points="39.1,47.24 42.05,50.12 41.36,54.17 45,52.26 48.64,54.17 47.95,50.12 50.9,47.24 46.82,46.65 45,42.96 43.18,46.65" />
  </g>
</svg>`,
};

function installFetchMock() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __dsFetchMocked?: boolean };
  if (w.__dsFetchMocked) return;
  w.__dsFetchMocked = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];

    if (path === "/capitol/registry") return jsonResponse(REGISTRY);
    if (path === "/capitol/settings") return jsonResponse({ darkMode: false, hiddenWidgets: [] });
    if (path === "/capitol/notifications" && method === "GET") {
      const unreadCount = NOTIFICATIONS.filter((n) => !n.readAt).length;
      return jsonResponse({ notifications: NOTIFICATIONS, unreadCount });
    }
    if (path.startsWith("/capitol/notifications/") && path.endsWith("/read") && method === "POST") return jsonResponse({ ok: true });
    if (path === "/capitol/notifications/read-all" && method === "POST") return jsonResponse({ ok: true });
    if (path.startsWith("/capitol/notifications/") && method === "DELETE") return jsonResponse({ ok: true });
    if (path.startsWith("/capitol/chambers/") && path.endsWith("/icon")) {
      const chamber = decodeURIComponent(path.split("/")[3] ?? "");
      const markup = CHAMBER_ICONS[chamber];
      return markup ? svgResponse(markup) : new Response("not found", { status: 404 });
    }
    if (path === "/capitol/exhibits/search") return jsonResponse({ results: SEARCH_RESULTS });
    if (path === "/capitol/exhibits/resolve" && method === "POST") return jsonResponse({ results: RESOLVE_RESULTS });
    if (path.endsWith("/backlinks")) return jsonResponse({ backlinks: RESOLVE_RESULTS.slice(0, 2) });
    if (path.endsWith("/frontlinks")) return jsonResponse({ frontlinks: RESOLVE_RESULTS.slice(2) });
    if (path.endsWith("/sharing")) return jsonResponse({ shares: SHARING_ENTRIES });
    if (path.endsWith("/shares") && method === "GET") return jsonResponse({ shares: [SHARE_SUMMARY] });
    if (path === "/capitol/shares" && method === "POST") return jsonResponse(SHARE_SUMMARY);
    if (path.startsWith("/capitol/shares/") && method === "PATCH") return jsonResponse(SHARE_SUMMARY);

    return realFetch(url, init);
  };
}

installFetchMock();

const previewQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

// Single provider every preview card wraps with - covers both the Router
// context (Link/useNavigate/useLocation, used by ChamberLayout/ChamberPicker)
// and the QueryClient context (useQuery, used by nearly every other
// congress-ui component) so no card needs to know which one it requires.
export function PreviewProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={previewQueryClient}>
      <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
