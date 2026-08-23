import { useMemo, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, get, set, del, clear, type UseStore } from "idb-keyval";

// One IndexedDB database per namespace (Congress itself, or a Chamber's own
// name) rather than one shared store - every Chamber is same-origin in
// production (proxied through Congress), so a single localStorage-backed
// persister would mean 8+ independent QueryClients competing for one
// ~5-10MB per-origin quota. IndexedDB partitions cleanly by database name,
// matching how each Chamber already gets its own isolated QueryClient
// instance.
const DB_PREFIX = "congress-query-cache-";
const stores = new Map<string, UseStore>();

function storeFor(namespace: string): UseStore {
  let store = stores.get(namespace);
  if (!store) {
    store = createStore(`${DB_PREFIX}${namespace}`, "queries");
    stores.set(namespace, store);
  }
  return store;
}

// A single reload's worth of patience for clearAppCaches below - it's a
// best-effort cleanup running right before a page reload, not something a
// pull-to-refresh gesture should ever be left hanging on indefinitely.
const CLEAR_TIMEOUT_MS = 2000;

// Empties every persisted-query IndexedDB database this app owns - not just
// the current page's own namespace, but every Chamber's, including ones
// never opened this session (discovered via indexedDB.databases() rather
// than a hardcoded chamber list - congress-ui has no business knowing every
// Chamber's name) - plus every Cache Storage entry the service worker owns
// (the precached shell, each Chamber's remote-entry bundle, the shared
// vendor bundle). Used by the pull-to-refresh "refresh" release
// (MobileSearchReveal) so a manual reload actually means "genuinely fresh
// everywhere", not "instantly rehydrated from whatever was cached, then
// silently revalidated in the background" - which is what a bare
// `location.reload()` amounts to given this persistence layer and the
// service worker's own cache-first shell.
//
// Deliberately never calls indexedDB.deleteDatabase - a prior version did,
// for a namespace this tab hadn't opened, on the theory that nothing here
// held it open so the delete couldn't block. In practice a delete request
// can still end up "blocked" (another tab of this same PWA, a stray
// leftover connection, a browser-specific quirk), and unlike a normal
// open(), a blocked *delete* doesn't just fail that one call - it parks
// itself in the browser's per-origin IndexedDB queue and stalls every
// later open() against that origin, including from a freshly reloaded
// page, until whatever's blocking it closes. That's fatal here specifically
// because PersistQueryClientProvider gates *every* query (the registry
// fetch included) behind its own IndexedDB restore - one stuck delete
// silently breaks navigation everywhere, which is exactly what this was
// caught doing. `clear(store)` only ever needs a same-version, non-exclusive
// open - safe to call on a namespace this tab has never touched, and safe
// to run concurrently with another tab's own connection to it.
export async function clearAppCaches(): Promise<void> {
  const namespaces = new Set(stores.keys());
  if (typeof indexedDB.databases === "function") {
    try {
      for (const db of await indexedDB.databases()) {
        if (db.name?.startsWith(DB_PREFIX)) namespaces.add(db.name.slice(DB_PREFIX.length));
      }
    } catch {
      // Best effort - fall back to whatever namespaces this tab already knows.
    }
  }

  const tasks: Promise<unknown>[] = [...namespaces].map((namespace) => clear(storeFor(namespace)).catch(() => {}));

  if ("caches" in window) {
    tasks.push(
      caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .catch(() => {})
    );
  }

  await Promise.race([Promise.allSettled(tasks), new Promise((resolve) => setTimeout(resolve, CLEAR_TIMEOUT_MS))]);
}

// Drop-in replacement for QueryClientProvider that additionally persists
// the query cache to IndexedDB and rehydrates it on boot - the mechanism
// that lets the shell (and every Chamber mounted into it) render
// previously-fetched data immediately on a cold load, offline or not,
// instead of showing nothing until a fresh network round-trip resolves.
// Mutations are deliberately left unpersisted (default
// dehydrateMutations: false) - offline mutation queueing/replay is a
// separate, harder problem than read caching and isn't handled here.
export function PersistedQueryProvider({
  client,
  namespace,
  children,
}: {
  client: QueryClient;
  namespace: string;
  children: ReactNode;
}) {
  // persistOptions itself must stay referentially stable across renders,
  // not just the persister inside it - PersistQueryClientProvider restarts
  // its restore/subscribe cycle whenever this object's identity changes, and
  // an inline `{ persister }` literal is a fresh object on every render,
  // which was retriggering restoration (and the queries waiting on
  // useIsRestoring) in a tight loop.
  const persistOptions = useMemo(() => {
    const store = storeFor(namespace);
    const persister = createAsyncStoragePersister({
      key: `congress-query-cache-${namespace}`,
      storage: {
        getItem: (key) => get(key, store),
        setItem: (key, value) => set(key, value, store),
        removeItem: (key) => del(key, store),
      },
    });
    return { persister };
  }, [namespace]);

  return (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
