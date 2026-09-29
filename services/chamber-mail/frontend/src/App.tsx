import { Route, Routes } from "react-router-dom";
import { ChamberIndexRedirect, useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ThreadPage } from "@/pages/ThreadPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No inbox page: unread threads reach the home feed and Search as exhibits. */}
        <Route index element={<ChamberIndexRedirect />} />
        <Route path="t/:accountId/:threadId" element={<ThreadPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
