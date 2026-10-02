import { Navigate, Route, Routes } from "react-router-dom";
import { ChamberLayout, ChamberMark, RouteCommitSignal, StackNavigator } from "@congress/congress-ui";
import { LoginGate } from "@/components/LoginGate";
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
import { RecordPage } from "@/records/RecordPage";
import { LegacyRedirect } from "@/records/LegacyRedirect";
import { TimelinePage, WeekPage } from "@/views/calendar/CalendarViews";
import { HealthPage } from "@/views/health/HealthViews";
import { NewRoutinePage } from "@/views/fitness/NewRoutinePage";
import { MapPage } from "@/views/map/MapPage";
import { PendingVisitsPage } from "@/views/map/PendingVisitsPage";
import { ChatPage } from "@/views/whatsapp/ChatPage";
import { ChatsPage } from "@/views/whatsapp/ChatsPage";

// The shell's top-level paths (keep the service worker's denylist in sw.ts in step).
export function App() {
  // App-wide, so a reply that lands while no chat is open still updates.
  useChatInvalidation();
  return (
    // One LoginGate around everything - the tab bar needs the same gate
    // every route already has.
    <LoginGate>
      <RouteCommitSignal />
      {/* One stack of pages per tab, kept equal to browser history. */}
      <StackNavigator />
      {/* The shell's one navigation (Home · Search · + · Notifications ·
          Settings), a sibling of Routes rather than nested in any page, so a
          page that fails only loses its own content, never the way back out. */}
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
        {/* The calendar's views over Event records. */}
        <Route path="/events" element={<TimelinePage />} />
        <Route path="/events/week" element={<WeekPage />} />
        {/* Fitness: Apple Health, and a new Hevy routine (it needs exercises before it exists). */}
        <Route path="/fitness/health" element={<HealthPage />} />
        <Route path="/e/new/routine" element={<NewRoutinePage />} />
        {/* The Map: the day's places and trips, and stops to classify (location connector). */}
        <Route path="/map" element={<MapPage />} />
        <Route path="/map/pending" element={<PendingVisitsPage />} />
        <Route path="/map/p/:id" element={<LegacyRedirect chamber="map" idPrefix="place-" noun="place" />} />
        <Route path="/map/places/new" element={<Navigate to="/e/new/place" replace />} />
        <Route path="/map/settings" element={<Navigate to="/settings?from=accounts" replace />} />
        <Route path="/map/*" element={<Navigate to="/map" replace />} />
        {/* WhatsApp: the chat list and a chat's messages (whatsapp connector; read-only). */}
        <Route element={<ChamberLayout icon={<ChamberMark name="whatsapp" className="h-8 w-8 text-ink" />} title="WhatsApp" ownChamber="whatsapp" />}>
          <Route path="/whatsapp" element={<ChatsPage />} />
          <Route path="/whatsapp/c/:jid" element={<ChatPage />} />
        </Route>
        <Route path="/whatsapp/settings" element={<Navigate to="/settings?from=accounts" replace />} />
        <Route path="/whatsapp/*" element={<Navigate to="/whatsapp" replace />} />
        {/* Every runtime exhibit type's records (typeEngine). */}
        <Route path="/e/new/:type" element={<RecordPage />} />
        <Route path="/e/:id" element={<RecordPage />} />
        {/* Retired Chambers' old URLs, now premade types. */}
        <Route path="/notes/n/:id" element={<LegacyRedirect chamber="notes" idPrefix="note-" noun="note" />} />
        <Route path="/notes/new" element={<Navigate to="/e/new/note" replace />} />
        <Route path="/notes/*" element={<Navigate to="/" replace />} />
        <Route path="/tasks/t/:id" element={<LegacyRedirect chamber="tasks" idPrefix="task-" noun="task" />} />
        <Route path="/tasks/new" element={<Navigate to="/e/new/task" replace />} />
        <Route path="/tasks/*" element={<Navigate to="/" replace />} />
        <Route
          path="/calendar/e/:acct/:cal/:evt"
          element={
            <LegacyRedirect
              chamber="calendar"
              idPrefix="event-"
              noun="event"
              idFrom={(p) => `${p.acct}:${encodeURIComponent(p.cal ?? "")}:${encodeURIComponent(p.evt ?? "")}`}
            />
          }
        />
        <Route path="/calendar/new" element={<Navigate to="/e/new/event" replace />} />
        <Route path="/calendar/week" element={<Navigate to="/events/week" replace />} />
        <Route path="/calendar/*" element={<Navigate to="/events" replace />} />
        <Route path="/documents/d/:id" element={<LegacyRedirect chamber="documents" idPrefix="document-" noun="document" />} />
        <Route path="/documents/new" element={<Navigate to="/e/new/document" replace />} />
        <Route path="/documents/*" element={<Navigate to="/" replace />} />
        <Route
          path="/mail/t/:acct/:thread"
          element={<LegacyRedirect chamber="mail" idPrefix="thread-" noun="email" idFrom={(p) => `${p.acct}:${p.thread}`} />}
        />
        <Route path="/mail/settings" element={<Navigate to="/settings?from=accounts" replace />} />
        <Route path="/mail/*" element={<Navigate to="/" replace />} />
        <Route path="/fitness/workouts/:id" element={<LegacyRedirect chamber="fitness" idPrefix="workout-" noun="workout" />} />
        <Route path="/fitness/routines/new" element={<Navigate to="/e/new/routine" replace />} />
        <Route path="/fitness/routines/:id" element={<LegacyRedirect chamber="fitness" idPrefix="routine-" noun="routine" />} />
        <Route path="/fitness/metrics" element={<Navigate to="/fitness/health" replace />} />
        <Route path="/fitness/settings" element={<Navigate to="/settings?from=accounts" replace />} />
        <Route path="/fitness/*" element={<Navigate to="/" replace />} />
        {/* Old URLs of Chambers folded into Congress - bookmarks and the
            installed PWA's saved URL land here. */}
        <Route path="/capitol/*" element={<Navigate to="/" replace />} />
        <Route path="/logs/*" element={<Navigate to="/settings?from=logs" replace />} />
        {/* Anything else (a retired Chamber's old path, a typo) goes home. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LoginGate>
  );
}
