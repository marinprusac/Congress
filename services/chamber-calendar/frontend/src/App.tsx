import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { AgendaPage } from "@/pages/AgendaPage";
import { EventEditorPage } from "@/pages/EventEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AgendaPage />} />
        <Route path="new" element={<EventEditorPage />} />
        <Route path="e/:accountId/:calendarId/:eventId" element={<EventEditorPage />} />
      </Route>
    </Routes>
  );
}
