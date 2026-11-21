import type { DashboardCard } from "@congress/shared-types";
import { parseJsonResponse as json } from "@congress/congress-ui";

export const dashboardQueryKey = ["congress", "dashboard"] as const;

export function fetchDashboard(): Promise<DashboardCard[]> {
  return fetch("/congress/dashboard")
    .then((res) => json<{ cards: DashboardCard[] }>(res))
    .then((body) => body.cards);
}
