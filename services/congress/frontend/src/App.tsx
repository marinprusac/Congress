import { Navigate, Route, Routes } from "react-router-dom";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { RouteCommitSignal, setRoutePreloader } from "@congress/congress-ui";
import { LoginGate } from "@/components/LoginGate";
import { ChamberHost, preloadChamber } from "@/components/ChamberHost";
import { queryClient } from "@/lib/queryClient";
import { chamberForPath } from "@/lib/routeChamber";
import { TabBar } from "@/components/TabBar";
import { SettingsPage } from "@/pages/SettingsPage";
import { HomePage } from "@/pages/HomePage";
import { ChatIndex, ChatLayout } from "@/chat/ChatLayout";
import { ThreadView } from "@/chat/ThreadView";
import { MemoryPage } from "@/chat/MemoryPage";
import { useChatInvalidation } from "@/chat/useChatData";
import { SearchPage } from "@/pages/SearchPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { ViewPage } from "@/pages/ViewPage";

// Page transitions wait for a Chamber's bundle so they animate the real page.
setRoutePreloader((path) => {
  const name = chamberForPath(path);
  const registry = queryClient.getQueryData<ChamberRegistryEntry[]>(["congress", "registry"]);
  if (!name || !registry?.some((c) => c.name === name && c.status === "active")) return undefined;
  return preloadChamber(name);
});

// Every top-level path below other than "/:chamber/*" is reserved: Congress
// refuses to register a Chamber by any of these names (shared-types'
// RESERVED_CHAMBER_NAMES), and the service worker serves them from the
// cached shell (sw.ts) - keep the three in step.
export function App() {
  // App-wide, so a reply that lands while no chat is open still updates.
  useChatInvalidation();
  return (
    // One LoginGate around everything - the tab bar needs the same gate
    // every route already has.
    <LoginGate>
      <RouteCommitSignal />
      {/* The shell's one navigation (Home · Search · + · Notifications ·
          Settings), a sibling of Routes rather than nested in any page, so a
          Chamber that fails to load only loses its own content, never the
          way back out. */}
      <TabBar />
      <Routes>
        {/* Congress's own home: the AI composer, pinned views and the "For
            You" feed. Works with no Chamber registered. */}
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* Congress's own AI chat: threads, one per conversation. */}
        <Route path="/chat" element={<ChatLayout />}>
          <Route index element={<ChatIndex />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path=":threadId" element={<ThreadView />} />
        </Route>
        {/* A view card with no full-screen page of its own, given the whole
            screen. */}
        <Route path="/view/:chamber/:viewId" element={<ViewPage />} />
        {/* Old URLs of Chambers folded into Congress - bookmarks and the
            installed PWA's saved URL land here. */}
        <Route path="/capitol/*" element={<Navigate to="/" replace />} />
        <Route path="/logs/*" element={<Navigate to="/settings?from=logs" replace />} />
        {/* Every Chamber renders here, hosted directly in this shell instead
            of navigating away to it. See ChamberHost's own comment. */}
        <Route path="/:chamber/*" element={<ChamberHost />} />
      </Routes>
    </LoginGate>
  );
}
