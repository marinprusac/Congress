import { initEnv } from "../env.js";
import { runMigrations, closeDb } from "./client.js";

initEnv(process.env);
runMigrations();
closeDb();
console.log("Migrations applied.");
