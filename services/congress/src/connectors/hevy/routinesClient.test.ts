import { beforeEach, describe, expect, it, vi } from "vitest";
import { HevyApiError, createRoutine, updateRoutine } from "./client.js";
import { normalizeRoutine, buildHevyCreateRoutineBody } from "./normalize.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: "", text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response;
}

function errorResponse(status: number, statusText: string, bodyText: string): Response {
  return { ok: false, status, statusText, text: () => Promise.resolve(bodyText) } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("createRoutine", () => {
  it("wraps the request body in a `routine` key", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "r1", title: "Push Day", exercises: [] }));

    await createRoutine("fake-key", { title: "Push Day", folder_id: null, exercises: [] });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ routine: { title: "Push Day", folder_id: null, exercises: [] } });
  });

  it("returns null when Hevy's 201 body is empty, per its own oneOf response schema", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    const result = await createRoutine("fake-key", { title: "Push Day", folder_id: null, exercises: [] });

    expect(result).toBeNull();
  });

  it("unwraps a `{ routine }`-wrapped success response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ routine: { id: "r1", title: "Push Day", exercises: [] } }));

    const result = await createRoutine("fake-key", { title: "Push Day", folder_id: null, exercises: [] });

    expect(result).toEqual({ id: "r1", title: "Push Day", exercises: [] });
  });
});

describe("updateRoutine", () => {
  it("sends a PUT with no folder_id in the wrapped body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "r1", title: "Push Day", exercises: [] }));

    await updateRoutine("fake-key", "r1", { title: "Push Day", exercises: [] });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ routine: { title: "Push Day", exercises: [] } });
    expect(body.routine).not.toHaveProperty("folder_id");
  });

  // Previously the failure status/statusText were kept but Hevy's own
  // response body (where a validation error actually names the rejected
  // field) was discarded - every write rejection surfaced as an opaque
  // "unknown_error" all the way up to whoever called the MCP tool.
  it("includes Hevy's response body in the thrown error's message", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(400, "Bad Request", JSON.stringify({ message: "exercise_template_id is invalid" })));

    await expect(updateRoutine("fake-key", "r1", { title: "Push Day", exercises: [] })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("exercise_template_id is invalid"),
    });
  });

  it("throws a HevyApiError instance on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(500, "Internal Server Error", ""));

    await expect(updateRoutine("fake-key", "r1", { title: "Push Day", exercises: [] })).rejects.toBeInstanceOf(HevyApiError);
  });
});

describe("normalizeRoutine", () => {
  it("reads the response's `supersets_id` (plural) field name", () => {
    const routine = normalizeRoutine({
      id: "r1",
      title: "Push Day",
      exercises: [
        {
          title: "Bench Press",
          exercise_template_id: "et1",
          supersets_id: 2,
          rest_seconds: 90,
          sets: [{ index: 0, type: "normal", weight_kg: 100, reps: 5 }],
        },
      ],
    });

    expect(routine.exercises[0]?.supersetId).toBe(2);
  });

  it("reads rep_range bounds onto repRangeStart/repRangeEnd", () => {
    const routine = normalizeRoutine({
      id: "r1",
      title: "Push Day",
      exercises: [
        {
          title: "Bench Press",
          exercise_template_id: "et1",
          sets: [{ index: 0, type: "normal", weight_kg: null, reps: null, rep_range: { start: 8, end: 12 } }],
        },
      ],
    });

    expect(routine.exercises[0]?.sets[0]).toMatchObject({ repRangeStart: 8, repRangeEnd: 12 });
  });
});

describe("buildHevyCreateRoutineBody", () => {
  it("always sends `superset_id` explicitly, even when null - omitting it sends 0 on Hevy's side and breaks grouping", () => {
    const body = buildHevyCreateRoutineBody({
      title: "Push Day",
      folderId: null,
      exercises: [{ exerciseTemplateId: "et1", supersetId: null, restSeconds: 90, sets: [] }],
    });

    const exercise = (body.exercises as Record<string, unknown>[])[0]!;
    expect(exercise).toHaveProperty("superset_id", null);
  });
});
