import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { loadRemoteModule, evictRemoteModule } from "@congress/congress-ui";

// Keyed by "<chamber>:<widgetId>", one lazy() wrapper per widget cell -
// finer-grained than ChamberHost's own per-chamber component cache, since a
// render failure here should only take down that one canvas cell, not every
// widget from the same Chamber. The underlying module+stylesheet fetch is
// still shared (and cached once) via congress-ui's loadRemoteModule.
const cache = new Map<string, LazyExoticComponent<ComponentType>>();

export function getWidgetComponent(chamber: string, widgetId: string): LazyExoticComponent<ComponentType> {
  const key = `${chamber}:${widgetId}`;
  let component = cache.get(key);
  if (!component) {
    component = lazy(async () => {
      const mod = await loadRemoteModule(chamber);
      const Widget = mod.widgets?.[widgetId];
      if (!Widget) throw new Error(`Chamber "${chamber}" has no widget "${widgetId}"`);
      return { default: Widget };
    });
    cache.set(key, component);
  }
  return component;
}

// Called from WidgetErrorBoundary.componentDidCatch - evicts both this
// specific widget's lazy() wrapper and (via evictRemoteModule) the whole
// Chamber's underlying module fetch, since a broken widget component might
// be a symptom of a stale/bad remote-entry.js, not just that one widget.
export function evictWidgetComponent(chamber: string, widgetId: string): void {
  cache.delete(`${chamber}:${widgetId}`);
  evictRemoteModule(chamber);
}
