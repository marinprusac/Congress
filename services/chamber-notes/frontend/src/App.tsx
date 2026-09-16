import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { NotesListPage } from "@/pages/NotesListPage";
import { NoteEditorPage } from "@/pages/NoteEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<NotesListPage />} />
        <Route path="n/:id" element={<NoteEditorPage />} />
        <Route path="new" element={<NoteEditorPage />} />
      </Route>
    </Routes>
  );
}
