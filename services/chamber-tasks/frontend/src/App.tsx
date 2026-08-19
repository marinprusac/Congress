import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { TasksListPage } from "@/pages/TasksListPage";
import { TaskViewPage } from "@/pages/TaskViewPage";
import { NewTaskPage } from "@/pages/NewTaskPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TasksListPage />} />
        <Route path="t/:id" element={<TaskViewPage />} />
        <Route path="new" element={<NewTaskPage />} />
      </Route>
    </Routes>
  );
}
