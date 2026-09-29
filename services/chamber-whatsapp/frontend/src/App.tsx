import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ChatsPage } from "@/pages/ChatsPage";
import { ChatPage } from "@/pages/ChatPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* The chat list is this Chamber's one view (manifest "chats"). */}
        <Route index element={<ChatsPage />} />
        <Route path="c/:jid" element={<ChatPage />} />
      </Route>
    </Routes>
  );
}
