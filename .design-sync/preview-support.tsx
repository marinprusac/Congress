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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

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
