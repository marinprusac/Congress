import { runMigrations, closeDb } from "./client.js";

runMigrations();
closeDb();
console.log("Migrations applied.");
