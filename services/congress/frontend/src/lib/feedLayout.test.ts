import { describe, expect, it } from "vitest";
import type { FeedItem } from "@congress/shared-types";
import { feedSlots } from "./feedLayout.js";

const view = (id: string): FeedItem => ({ kind: "view", chamber: "map", viewId: id, label: id, score: 50 }) as FeedItem;
const record = (id: string, withPreview = true): FeedItem =>
  ({
    kind: "record",
    chamber: "e",
    recordId: id,
    name: id,
    url: `/${id}`,
    type: "task",
    score: 50,
    ...(withPreview ? { preview: { title: id } } : {}),
  }) as FeedItem;

describe("feedSlots", () => {
  it("is empty for an empty feed", () => {
    expect(feedSlots([])).toEqual([]);
  });

  it("makes the first record the lead and keeps ranker order", () => {
    expect(feedSlots([record("a"), record("b"), view("m")])).toEqual(["lead", "item", "view"]);
  });

  it("never lets a view card lead, even when it ranks first", () => {
    expect(feedSlots([view("m"), record("a"), record("b")])).toEqual(["view", "lead", "item"]);
  });

  it("skips records without a preview when picking the lead", () => {
    expect(feedSlots([record("a", false), record("b")])).toEqual(["item", "lead"]);
  });

  it("has no lead when nothing qualifies", () => {
    expect(feedSlots([view("m"), record("a", false)])).toEqual(["view", "item"]);
  });
});
