import type { ChamberModule } from "@congress/chamber-kit";

// Every Chamber module currently running inside this process, by name.
const modules = new Map<string, ChamberModule>();

export function addModule(module: ChamberModule): void {
  modules.set(module.manifest.name, module);
}

export function removeModule(name: string): void {
  modules.delete(name);
}

export function getModule(name: string): ChamberModule | null {
  return modules.get(name) ?? null;
}

export function listModules(): ChamberModule[] {
  return [...modules.values()];
}

export class ChamberNotLoadedError extends Error {
  constructor(name: string) {
    super(`Chamber not loaded: ${name}`);
  }
}

// Calls a Chamber's own API in-process: `path` is relative to its /api
// (e.g. "/exhibits/search?q=x"). An `init.signal` is honoured as a timeout,
// since app.fetch itself can't be aborted.
export async function chamberFetch(name: string, path: string, init: RequestInit = {}): Promise<Response> {
  const module = modules.get(name);
  if (!module) throw new ChamberNotLoadedError(name);
  const request = new Request(`http://${name}.chamber/api${path}`, init);
  const response = Promise.resolve(module.app.fetch(request));
  const signal = init.signal;
  if (!signal) return response;
  signal.throwIfAborted();
  return Promise.race([
    response,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ]);
}
