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
// pull-to-refresh gesture should ever be left hanging on indefinitely (a
// stray IndexedDB connection this tab doesn't know about can leave a
// deleteDatabase call permanently "blocked").
const CLEAR_TIMEOUT_MS = 2000;

// Empties every persisted-query IndexedDB database this app owns - not just
// the current page's own namespace, but every Chamber's, including ones
// never opened this session (discovered via indexedDB.databases() rather
// than a hardcoded chamber list - congress-ui has no business knowing every
// Chamber's name) - plus every Cache Storage entry the service worker owns
// (the precached shell, each Chamber's remote-entry bundle, the shared
// vendor bundle). A database this tab already has an open connection to
// (tracked in `stores` - the current namespace, and any Chamber visited
// this session) can't be safely deleted outright without risking an
// indefinitely "blocked" request, so those are emptied in place with
// idb-keyval's own `clear` instead; a database nothing in this tab has
// opened is deleted outright. Used by the pull-to-refresh "refresh" release
// (MobileSearchReveal) so a manual reload actually means "genuinely fresh
// everywhere", not "instantly rehydrated from whatever was cached, then
// silently revalidated in the background" - which is what a bare
// `location.reload()` amounts to given this persistence layer and the
// service worker's own cache-first shell.
export async function clearAppCaches(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  for (const store of stores.values()) {
    tasks.push(clear(store).catch(() => {}));
  }

  if (typeof indexedDB.databases === "function") {
    tasks.push(
      indexedDB
        .databases()
        .then((dbs) =>
          Promise.all(
            dbs
              .filter((db) => db.name?.startsWith(DB_PREFIX) && !stores.has(db.name.slice(DB_PREFIX.length)))
              .map(
                (db) =>
                  new Promise<void>((resolve) => {
                    const request = indexedDB.deleteDatabase(db.name!);
                    request.onsuccess = () => resolve();
                    request.onerror = () => resolve();
                    // Nothing in this tab holds it open (that's the whole
                    // point of this branch) - if it's blocked anyway, it's
                    // some other tab/origin-worker's connection, out of our
                    // control. Stop waiting rather than hang the reload.
                    request.onblocked = () => resolve();
                  })
              )
          )
        )
        .catch(() => {})
    );
  }

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
