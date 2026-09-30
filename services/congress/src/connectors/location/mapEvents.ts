import type { ManifestEvent } from "@congress/shared-types";

// What tracking publishes (the Map Chamber's catalog, placeId now a Place record id).
export const MAP_EVENTS: ManifestEvent[] = [
  {
    type: "map.arrived_at_place",
    label: "Arrived at place",
    description: "The tracked device arrived at a known place.",
    payloadFields: {
      visitId: { type: "number" },
      placeId: { type: "string", description: "The Place record id" },
      placeName: { type: "string" },
      at: { type: "string", description: "ISO datetime" },
    },
  },
  {
    type: "map.departed_place",
    label: "Departed place",
    description: "The tracked device left a known place.",
    payloadFields: {
      visitId: { type: "number" },
      placeId: { type: "string", description: "The Place record id" },
      placeName: { type: "string" },
      durationMinutes: { type: "number" },
      at: { type: "string", description: "ISO datetime" },
    },
  },
  {
    type: "map.trip_completed",
    label: "Trip completed",
    description: "A trip between two visits was summarized.",
    payloadFields: {
      tripId: { type: "number" },
      fromPlace: { type: "string" },
      toPlace: { type: "string" },
      distanceKm: { type: "number" },
      mode: { type: "string", description: "walk | bike | transit | unknown" },
      durationMinutes: { type: "number" },
    },
  },
  {
    type: "map.unclassified_dwell_pending",
    label: "Unclassified dwell pending",
    description: "The device has been dwelling at an unrecognized location and needs classification.",
    payloadFields: {
      visitId: { type: "number" },
      clusterLatitude: { type: "number" },
      clusterLongitude: { type: "number" },
      dwellMinutes: { type: "number" },
    },
  },
  {
    type: "map.traccar_poll_failing",
    label: "Traccar poll failing",
    description: "Polling the Traccar server has failed several times in a row.",
    payloadFields: { consecutiveFailures: { type: "number" }, lastError: { type: "string" } },
  },
  {
    type: "map.tracking_stale",
    label: "Tracking data is stale",
    description: "Polling Traccar keeps succeeding, but the device hasn't sent a real position in longer than the configured threshold - a phone-side issue (permissions, background refresh, the tracker app being closed), not a poll failure.",
    payloadFields: {
      lastFixAt: { type: "string", description: "ISO datetime of the last real position received" },
      staleMinutes: { type: "number" },
    },
  },
  {
    type: "map.tracking_resumed",
    label: "Tracking data resumed",
    description: "The device started sending real positions again after a map.tracking_stale alert.",
    payloadFields: { lastFixAt: { type: "string", description: "ISO datetime of the first fresh position received" } },
  },
];
