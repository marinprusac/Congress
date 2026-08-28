// Several things in this system are deliberately fire-and-forget - Congress
// relays an event without awaiting delivery, and a Chamber's own
// /api/events/receive answers before its handler finishes. There is no
// completion signal to await, so a test that wants to observe the effect has
// to poll for it. Fails loudly on timeout rather than silently passing.
export async function waitFor(predicate: () => boolean, timeoutMs = 2_000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}
