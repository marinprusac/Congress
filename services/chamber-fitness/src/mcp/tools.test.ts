import { describe, expect, it } from "vitest";
import { HevyApiError } from "../hevy/client.js";
import { RoutinesError } from "../routines.js";
import { routineToolError } from "./tools.js";

// The routine MCP tools used to collapse every non-RoutinesError failure to
// a bare `{ error: "unknown_error" }`, which is exactly how a real Hevy
// rejection (a HevyApiError carrying the actual status/response body) went
// undiagnosable end to end - see routines.ts's updateRoutine, which only
// special-cases 404 and rethrows everything else as-is.
describe("routineToolError", () => {
  it("keeps a RoutinesError's own code", () => {
    expect(routineToolError(new RoutinesError("hevy_not_configured"))).toEqual({
      error: "hevy_not_configured",
      message: "hevy_not_configured",
    });
  });

  it("surfaces a HevyApiError's status and message instead of flattening it", () => {
    const err = new HevyApiError("Hevy API request failed: 400 Bad Request - exercise_template_id is invalid", 400);
    expect(routineToolError(err)).toEqual({
      error: "hevy_api_error",
      status: 400,
      message: err.message,
    });
  });

  it("falls back to unknown_error for anything else, but keeps the message", () => {
    expect(routineToolError(new Error("boom"))).toEqual({ error: "unknown_error", message: "boom" });
  });
});
