import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchInterval: 15_000,
      retry: 2,
      // See packages/congress-ui/src/queryClient.ts's createQueryClient for
      // why - same reasoning, hand-rolled here because this client's other
      // defaults diverge from that shared factory.
      networkMode: "offlineFirst",
    },
  },
});
