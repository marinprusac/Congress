import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { computeSubscriptions, setSubscriptionChangeNotifier } from "./subscriptions.js";

const { heartbeatNow } = createChamberBootstrap({
  displayName: "Automation Chamber",
  manifest,
  app,
  env,
  runMigrations,
  closeDb,
  getSubscriptions: computeSubscriptions,
});
setSubscriptionChangeNotifier(() => void heartbeatNow());
