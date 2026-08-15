import { QueryClient } from "@tanstack/react-query";

// The default TanStack Query config every Chamber's standalone/shell-hosted
// entry point constructs its own instance from - each Chamber still gets its
// own QueryClient (cache isolation), just with shared defaults. Capitol's
// own entry point uses different defaults (longer staleTime, a
// refetchInterval, more retries) and constructs its QueryClient directly
// rather than through this factory.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 1,
      },
    },
  });
}
