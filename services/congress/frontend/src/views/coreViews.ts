import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ManifestView } from "@congress/shared-types";
import { HealthCard } from "@/views/health/HealthViews";
import { TodayMapWidget } from "@/views/map/TodayMapWidget";
import { fetchTypes, TYPES_KEY } from "@/lib/recordsApi";

// Every view the owner can open or pin: Congress's own hand-written ones,
// shown once their type is in use.

export interface ViewSource {
  name: string;
  displayName: string;
  views: (ManifestView & { Card?: ComponentType })[];
}

// `type`: shown once that type is in use.
const CORE_VIEWS: (ViewSource & { type: string })[] = [
  {
    name: "events",
    displayName: "Calendar",
    type: "event",
    views: [
      { id: "timeline", label: "Timeline", fullPath: "/" },
      { id: "week", label: "Week", fullPath: "/week" },
    ],
  },
  {
    name: "fitness",
    displayName: "Fitness",
    type: "workout",
    views: [{ id: "health", label: "Health", fullPath: "/health", card: true, Card: HealthCard }],
  },
  {
    name: "map",
    displayName: "Map",
    type: "place",
    views: [
      { id: "today-map", label: "Today", fullPath: "/", card: true, Card: TodayMapWidget },
      { id: "pending", label: "Visits to classify", fullPath: "/pending" },
    ],
  },
  // Same name and view id as the Chamber, so a pinned chat list keeps working.
  { name: "whatsapp", displayName: "WhatsApp", type: "chat", views: [{ id: "chats", label: "WhatsApp", fullPath: "/" }] },
];

// A core view with its own card, for the feed and /view/... (null for a Chamber's).
export function findCoreView(name: string, viewId: string) {
  const source = CORE_VIEWS.find((s) => s.name === name);
  const view = source?.views.find((v) => v.id === viewId);
  return source && view ? { source, view } : null;
}

export function useViewSources(): ViewSource[] {
  const { data: types } = useQuery({ queryKey: TYPES_KEY, queryFn: fetchTypes });
  const inUse = new Set((types ?? []).filter((t) => !t.definition.hidden).map((t) => t.definition.slug));
  return CORE_VIEWS.filter((v) => inUse.has(v.type));
}

export function findView(sources: ViewSource[], name: string, viewId: string): { source: ViewSource; view: ManifestView } | null {
  const source = sources.find((s) => s.name === name);
  const view = source?.views.find((v) => v.id === viewId);
  return source && view ? { source, view } : null;
}
