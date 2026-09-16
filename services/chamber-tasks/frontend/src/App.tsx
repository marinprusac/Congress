import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { TasksListPage } from "@/pages/TasksListPage";
import { TaskEditorPage } from "@/pages/TaskEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TasksListPage />} />
        <Route path="t/:id" element={<TaskEditorPage />} />
        <Route path="new" element={<TaskEditorPage />} />
      </Route>
    </Routes>
  );
}
