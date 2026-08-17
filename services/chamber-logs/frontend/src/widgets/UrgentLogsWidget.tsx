import { HistoryFeed } from "./HistoryFeed";

export function UrgentLogsWidget() {
  return <HistoryFeed label="Urgent" minPriority="high" emptyLabel="— Nothing high-priority yet —" />;
}
