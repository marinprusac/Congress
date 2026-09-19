import { useSearchParams } from "react-router-dom";
import { PushNotificationsSection } from "@/components/PushNotificationsSection";
import { EventSettingsListPage } from "@/pages/EventSettingsListPage";
import { EventSettingsDetailPage } from "@/pages/EventSettingsDetailPage";

// Settings -> Logs: what Congress does when an event fires (record to
// history and/or push a notification), plus this device's Web Push opt-in.
// The selected event type lives in the query string (?from=logs&event=...)
// rather than a nested route, since Settings itself is a single tabbed page.
export function LogsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventType = searchParams.get("event");

  if (eventType) {
    return <EventSettingsDetailPage eventType={eventType} onBack={() => setSearchParams({ from: "logs" })} />;
  }

  return (
    <div className="space-y-8">
      <PushNotificationsSection />
      <EventSettingsListPage onOpen={(event) => setSearchParams({ from: "logs", event })} />
    </div>
  );
}
