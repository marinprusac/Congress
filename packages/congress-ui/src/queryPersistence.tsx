import { useMemo, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, get, set, del, type UseStore } from "idb-keyval";

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
