import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AgendaPage } from "@/pages/AgendaPage";
import { NewEventPage } from "@/pages/NewEventPage";
import { EventViewPage } from "@/pages/EventViewPage";
import { EditEventPage } from "@/pages/EditEventPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WidgetPreviewPage } from "@/pages/WidgetPreviewPage";

export function App() {
  return (
    <Routes>
      {/* No Layout chrome here — this route is embedded in an iframe as
          Capitol's homepage widget for this Chamber, not visited directly. */}
      <Route path="widget" element={<WidgetPreviewPage />} />
      <Route element={<Layout />}>
        <Route index element={<AgendaPage />} />
        <Route path="new" element={<NewEventPage />} />
        <Route path="e/:accountId/:calendarId/:eventId" element={<EventViewPage />} />
        <Route path="e/:accountId/:calendarId/:eventId/edit" element={<EditEventPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
