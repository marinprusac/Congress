import type { Manifest } from "@congress/shared-types";

export const manifest: Manifest = {
  name: "whatsapp",
  displayName: "WhatsApp",
  version: "0.1.0",
  routes: {
    home: "/whatsapp",
    settings: "/whatsapp/settings",
  },
  // The chat list is a genuine screen. No exhibitTypes, feed or events:
  // WhatsApp content stays inside this Chamber (not in Search, feed or the AI).
  views: [{ id: "chats", label: "WhatsApp", fullPath: "/" }],
  exhibitTypes: [],
  events: [],
};
