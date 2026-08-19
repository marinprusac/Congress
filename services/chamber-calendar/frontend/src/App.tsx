import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { AgendaPage } from "@/pages/AgendaPage";
import { NewEventPage } from "@/pages/NewEventPage";
import { EventViewPage } from "@/pages/EventViewPage";
import { EditEventPage } from "@/pages/EditEventPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AgendaPage />} />
        <Route path="new" element={<NewEventPage />} />
        <Route path="e/:accountId/:calendarId/:eventId" element={<EventViewPage />} />
        <Route path="e/:accountId/:calendarId/:eventId/edit" element={<EditEventPage />} />
      </Route>
    </Routes>
  );
}
