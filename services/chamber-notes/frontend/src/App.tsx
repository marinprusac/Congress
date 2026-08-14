import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/exhibit-ui";
import { Layout } from "@/components/Layout";
import { NotesListPage } from "@/pages/NotesListPage";
import { NoteViewPage } from "@/pages/NoteViewPage";
import { NewNotePage } from "@/pages/NewNotePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WidgetPreviewPage } from "@/pages/WidgetPreviewPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      {/* No Layout chrome here — this route is embedded in an iframe as
          Capitol's homepage widget for this Chamber, not visited directly. */}
      <Route path="widget" element={<WidgetPreviewPage />} />
      <Route element={<Layout />}>
        <Route index element={<NotesListPage />} />
        <Route path="n/:id" element={<NoteViewPage />} />
        <Route path="new" element={<NewNotePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
