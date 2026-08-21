import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // No default refetchInterval - it used to apply to every query the
      // shell owns, not just the one it was meant for (the Chamber
      // registry), so every query in the app background-refetched every 15s
      // for as long as the tab stayed open. The registry query below sets
      // its own, much longer interval instead; everything else relies on
      // staleTime plus refetchOnWindowFocus (on by default) for the case
      // that actually matters - coming back to a backgrounded tab.
      retry: 2,
      // See packages/congress-ui/src/queryClient.ts's createQueryClient for
      // why - same reasoning, hand-rolled here because this client's other
      // defaults diverge from that shared factory.
      networkMode: "offlineFirst",
    },
  },
});
