import { HistoryFeed } from "./HistoryFeed";

export function RecentLogsWidget() {
  return <HistoryFeed label="Recent" emptyLabel="— Nothing recorded yet —" />;
}
