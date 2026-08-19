import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { NotesListPage } from "@/pages/NotesListPage";
import { NoteViewPage } from "@/pages/NoteViewPage";
import { NewNotePage } from "@/pages/NewNotePage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<NotesListPage />} />
        <Route path="n/:id" element={<NoteViewPage />} />
        <Route path="new" element={<NewNotePage />} />
      </Route>
    </Routes>
  );
}
