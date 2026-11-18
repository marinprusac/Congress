import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client.js")>()),
  fetchTransactions: vi.fn(),
  listBanks: vi.fn(),
  startAuth: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchBalances: vi.fn(),
}));

import { createSession, describeError, fetchBalances, fetchTransactions, listBanks, signJwt, startAuth } from "./client.js";
import { bankDb, runBankMigrations } from "./db/client.js";
import { markTransfers, addPendingAuth, getBankSettings, listAccounts, listConnections, saveConnection, takePendingAuth, updateBankSettings, getTransactionRow, transactionRecord, upsertTransaction } from "./cache.js";
import { normalizeTransaction, normalizeTransactions } from "./normalize.js";
import { syncBanks } from "./sync.js";
import { bankHooks, bankPanelRoutes } from "./routes.js";
import { registerBankTools } from "./tools.js";
import { enableBankingConnector } from "./index.js";
import type { ConnectorContext } from "../contract.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const changes: { kind: string; key: string; deleted: boolean; quiet: boolean }[] = [];
const published: { type: string; payload: Record<string, unknown> }[] = [];
let synced = 0;
const ctx = {
  name: "enablebanking",
  google: { accounts: () => [], fetch: async () => undefined },
  people: { find: () => null, resolve: () => null },
  records: { idFor: () => null, list: () => [] },
  emitChange: (kind: string, key: string, deleted = false, quiet = false) => changes.push({ kind, key, deleted, quiet }),
  publish: (type: string, payload: Record<string, unknown>) => published.push({ type, payload }),
  syncNow: () => synced++,
  reschedule: () => {},
} as ConnectorContext;

const NOW = Date.parse("2026-11-18T12:00:00Z");
const H = 3_600_000;
const tx = (id: string, amount: string, date: string, extra: Record<string, unknown> = {}) => ({
  entry_reference: id,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  creditor: { name: "Konzum" },
  booking_date: date,
  remittance_information: ["Groceries"],
  ...extra,
});

function connect(validUntil = "2027-02-01T00:00:00Z", uid = "acc-1") {
  saveConnection({ sessionId: "s1", bank: "Zagrebačka banka", country: "HR", validUntil, accounts: [{ uid, name: "Main", iban: "HR12", currency: "EUR" }] });
}

beforeAll(() => runBankMigrations());

beforeEach(() => {
  for (const t of ["transactions", "accounts", "connections", "pending_auths", "settings"]) bankDb.run(sql.raw(`delete from ${t}`));
  changes.length = 0;
  published.length = 0;
  synced = 0;
  vi.mocked(fetchTransactions).mockReset();
  vi.mocked(createSession).mockReset();
  vi.mocked(startAuth).mockReset();
  vi.mocked(listBanks).mockReset();
  updateBankSettings({ appId: "app-1", privateKey });
});

describe("signJwt", () => {
  it("signs RS256 with the app id as kid and a verifiable signature", () => {
    const jwt = signJwt({ appId: "app-1", privateKey }, NOW);
    const [h, b, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-1" });
    const claims = JSON.parse(Buffer.from(b, "base64url").toString());
    expect(claims).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: NOW / 1000 });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(86_400);
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(createPublicKey(publicKey), Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("describeError", () => {
  it("makes Enable Banking's JSON error one readable line", () => {
    expect(describeError(400, '{"code":400,"message":"Redirect URI not allowed","error":"REDIRECT_URI_NOT_ALLOWED","detail":null}')).toBe("Enable Banking 400: REDIRECT_URI_NOT_ALLOWED - Redirect URI not allowed");
    expect(describeError(502, "<html>bad gateway</html>")).toBe("Enable Banking 502: <html>bad gateway</html>");
  });
});

describe("normalize", () => {
  it("signs money out as negative and names the counterparty by direction", () => {
    expect(normalizeTransaction("a", tx("e1", "12.50", "2026-11-01"))).toMatchObject({ key: "a:e1", amount: -12.5, counterparty: "Konzum", description: "Groceries" });
    const income = normalizeTransaction("a", { ...tx("e2", "100", "2026-11-02"), credit_debit_indicator: "CRDT", debtor: { name: "Employer" } });
    expect(income).toMatchObject({ amount: 100, counterparty: "Employer" });
  });

  it("drops entries without an amount or a date", () => {
    expect(normalizeTransaction("a", { entry_reference: "x", booking_date: "2026-11-01" })).toBeNull();
    expect(normalizeTransaction("a", { entry_reference: "x", transaction_amount: { amount: "1", currency: "EUR" } })).toBeNull();
  });

  it("keys id-less entries by content, and numbers identical ones instead of merging them", () => {
    const coffee = { transaction_amount: { currency: "EUR", amount: "2.00" }, credit_debit_indicator: "DBIT", creditor: { name: "Cafe" }, booking_date: "2026-11-03" };
    const [a, b] = normalizeTransactions("a", [coffee, coffee]);
    expect(a!.key).toMatch(/^a:h[0-9a-f]{20}$/);
    expect(b!.key).toBe(`${a!.key}#2`);
    expect(normalizeTransactions("a", [coffee])[0]!.key).toBe(a!.key);
  });
});

describe("normalize: bank quirks and detail", () => {
  const entry = (text: string, extra: Record<string, unknown> = {}) => ({ entry_reference: "r", transaction_amount: { currency: "EUR", amount: "100.00" }, credit_debit_indicator: "CRDT", booking_date: "2026-11-15", remittance_information: [text], ...extra });

  it("reads Zagrebačka's card purchases and fees (reported as credits) as money out, and leaves real credits alone", () => {
    expect(normalizeTransaction("a", entry("Kupovina Revolut**7915* Dublin IE"), { country: "HR" })!.amount).toBe(-100);
    expect(normalizeTransaction("a", entry("Naknada za obradu prekogran. priljeva"), { country: "HR" })!.amount).toBe(-100);
    expect(normalizeTransaction("a", entry("HR99 M-ZABA UPLATA PATRIK Renta"), { country: "HR" })!.amount).toBe(100);
    expect(normalizeTransaction("a", entry("Priljev iz inozemstva IGEM LUND"), { country: "HR" })!.amount).toBe(100);
  });

  it("applies that only to Croatian banks", () => {
    expect(normalizeTransaction("a", entry("Kupovina something"), { country: "SE" })!.amount).toBe(100);
    expect(normalizeTransaction("a", entry("Kupovina something"))!.amount).toBe(100);
  });

  it("falls back to the amount's sign when a bank sends no indicator", () => {
    expect(normalizeTransaction("a", entry("x", { credit_debit_indicator: undefined, transaction_amount: { currency: "SEK", amount: "-42.5" } }))!.amount).toBe(-42.5);
  });

  it("keeps the merchant category, the bank's code and the other party's IBAN", () => {
    const t = normalizeTransaction("a", entry("x", { credit_debit_indicator: "DBIT", merchant_category_code: "5411", bank_transaction_code: { description: "Card payment" }, creditor_account: { iban: "LT1" }, debtor_account: { iban: "SE9" } }))!;
    expect(t).toMatchObject({ mcc: "5411", bankCode: "Card payment", counterpartyIban: "LT1" });
  });
});

describe("own-account transfers", () => {
  function twoAccounts() {
    saveConnection({ sessionId: "z", bank: "Zagrebačka banka", country: "HR", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "z1", name: "", iban: "HR1", currency: "EUR" }] });
    saveConnection({ sessionId: "r", bank: "Revolut", country: "LT", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "r1", name: "", iban: "LT1", currency: "EUR" }] });
  }
  const set = (a: string, key: string, amount: number, date: string, over: Record<string, unknown> = {}) =>
    upsertTransaction(a, { key, bookingDate: date, amount, currency: "EUR", counterparty: "", description: "", mcc: null, bankCode: null, counterpartyIban: null, ...over });
  const marks = () => Object.fromEntries(["z1:o", "r1:i", "z1:o2", "r1:i2", "r1:x"].map((k) => [k, getTransactionRow(k)?.transfer ?? null]));

  it("pairs an outgoing entry with an equal incoming one on another account within 3 days, both ways marked", () => {
    twoAccounts();
    set("z1", "z1:o", -100, "2026-11-15");
    set("r1", "r1:i", 100, "2026-11-17");
    expect(markTransfers().sort()).toEqual(["r1:i", "z1:o"]);
    expect(marks()).toMatchObject({ "z1:o": "own", "r1:i": "own" });
  });

  it("leaves alone entries too far apart, of different size, or on the same account", () => {
    twoAccounts();
    set("z1", "z1:o", -100, "2026-11-10");
    set("r1", "r1:i", 100, "2026-11-15");
    set("r1", "r1:x", -100, "2026-11-10");
    set("z1", "z1:o2", -50, "2026-11-10");
    set("r1", "r1:i2", 100.5, "2026-11-10");
    expect(markTransfers()).toEqual([]);
  });

  it("uses each incoming entry once: two outgoing, one incoming makes one transfer", () => {
    twoAccounts();
    set("z1", "z1:o", -100, "2026-11-15");
    set("z1", "z1:o2", -100, "2026-11-15");
    set("r1", "r1:i", 100, "2026-11-15");
    expect(markTransfers()).toHaveLength(2);
    expect(Object.values(marks()).filter((v) => v === "own")).toHaveLength(2);
  });

  it("recognises a move by the other party's IBAN being one of the owner's accounts, even with no twin", () => {
    twoAccounts();
    set("z1", "z1:o", -80, "2026-11-15", { counterpartyIban: "LT1" });
    set("z1", "z1:o2", -80, "2026-11-15", { counterpartyIban: "SE_UNKNOWN" });
    set("z1", "z1:self", -5, "2026-11-15", { counterpartyIban: "HR1" });
    expect(markTransfers()).toEqual(["z1:o"]);
  });

  it("is stable: a second pass changes nothing", () => {
    twoAccounts();
    set("z1", "z1:o", -100, "2026-11-15");
    set("r1", "r1:i", 100, "2026-11-15");
    markTransfers();
    expect(markTransfers()).toEqual([]);
  });
});

describe("sync", () => {
  it("does nothing without credentials", async () => {
    updateBankSettings({ appId: null, privateKey: null });
    expect(await syncBanks(ctx, NOW)).toEqual({ changed: 0, error: null });
    expect(fetchTransactions).not.toHaveBeenCalled();
  });

  it("backfills 90 days quietly, then reads from a week before what it has, announcing only what's new", async () => {
    connect();
    vi.mocked(fetchTransactions).mockResolvedValueOnce([tx("e1", "10", "2026-11-10"), tx("e2", "5", "2026-11-12")]);
    expect(await syncBanks(ctx, NOW)).toEqual({ changed: 2, error: null });
    expect(vi.mocked(fetchTransactions).mock.calls[0]![2]).toBe("2026-08-20");
    expect(changes.every((c) => c.quiet)).toBe(true);
    expect(listAccounts()[0]!.syncedThrough).toBe("2026-11-12");

    changes.length = 0;
    vi.mocked(fetchTransactions).mockResolvedValueOnce([tx("e2", "5", "2026-11-12"), tx("e3", "7", "2026-11-17")]);
    expect(await syncBanks(ctx, NOW + 6 * H)).toEqual({ changed: 1, error: null });
    expect(vi.mocked(fetchTransactions).mock.calls[1]![2]).toBe("2026-11-05");
    expect(changes).toEqual([{ kind: "transaction", key: "acc-1:e3", deleted: false, quiet: false }]);
  });

  it("re-emits an entry the bank amended inside the overlap window", async () => {
    connect();
    vi.mocked(fetchTransactions).mockResolvedValueOnce([tx("e1", "10", "2026-11-10")]);
    await syncBanks(ctx, NOW);
    changes.length = 0;
    vi.mocked(fetchTransactions).mockResolvedValueOnce([tx("e1", "10.40", "2026-11-10")]);
    await syncBanks(ctx, NOW + 6 * H);
    expect(changes).toHaveLength(1);
    expect(getTransactionRow("acc-1:e1")!.amount).toBe(-10.4);
  });

  it("skips an expired consent and says so, without calling the bank", async () => {
    connect("2026-11-01T00:00:00Z");
    const res = await syncBanks(ctx, NOW);
    expect(res.error).toContain("consent expired");
    expect(fetchTransactions).not.toHaveBeenCalled();
  });

  it("warns once when the consent has under a week left", async () => {
    connect("2026-11-22T00:00:00Z");
    vi.mocked(fetchTransactions).mockResolvedValue([]);
    await syncBanks(ctx, NOW);
    await syncBanks(ctx, NOW + 6 * H);
    expect(published.filter((p) => p.type === "banks.consent_expiring")).toHaveLength(1);
  });

  it("keeps going past one failing account, and alerts on the third failed sync in a row", async () => {
    saveConnection({ sessionId: "s1", bank: "Revolut", country: "LT", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "bad", name: "A", iban: null, currency: "EUR" }, { uid: "ok", name: "B", iban: null, currency: "EUR" }] });
    vi.mocked(fetchTransactions).mockImplementation(async (_c, uid) => {
      if (uid === "bad") throw new Error("429");
      return [tx("e1", "1", "2026-11-10")];
    });
    for (let i = 0; i < 3; i++) expect((await syncBanks(ctx, NOW + i * 6 * H)).error).toContain("429");
    expect(getTransactionRow("ok:e1")).toBeDefined();
    expect(published.filter((p) => p.type === "banks.sync_failing")).toHaveLength(1);
    expect(getBankSettings().consecutiveFailures).toBe(3);
  });

  it("asks each account at most once per 5 hours, however often it's started or synced by hand", async () => {
    connect();
    vi.mocked(fetchTransactions).mockResolvedValue([]);
    await syncBanks(ctx, NOW);
    await syncBanks(ctx, NOW + 1000);
    await syncBanks(ctx, NOW + 4 * H);
    expect(fetchTransactions).toHaveBeenCalledTimes(1);
    await syncBanks(ctx, NOW + 5 * H + 1);
    expect(fetchTransactions).toHaveBeenCalledTimes(2);
  });

  it("counts a failed attempt too, so an erroring bank isn't hammered on every restart", async () => {
    connect();
    vi.mocked(fetchTransactions).mockRejectedValue(new Error("429"));
    await syncBanks(ctx, NOW);
    await syncBanks(ctx, NOW + H);
    expect(fetchTransactions).toHaveBeenCalledTimes(1);
  });

  it("clears the failure streak after a clean sync", async () => {
    connect();
    vi.mocked(fetchTransactions).mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    await syncBanks(ctx, NOW);
    expect(getBankSettings().consecutiveFailures).toBe(1);
    await syncBanks(ctx, NOW + 6 * H);
    expect(getBankSettings()).toMatchObject({ consecutiveFailures: 0, lastError: null });
  });
});

describe("pending consent nonce", () => {
  it("is single use and expires", () => {
    addPendingAuth("n1", "Revolut", "LT", 1000);
    expect(takePendingAuth("n1", 2000)).toEqual({ bank: "Revolut", country: "LT" });
    expect(takePendingAuth("n1", 2000)).toBeNull();
    addPendingAuth("n2", "Revolut", "LT", 1000);
    expect(takePendingAuth("n2", 1000 + 31 * 60_000)).toBeNull();
  });
});

describe("panel and callback", () => {
  const panel = () => bankPanelRoutes(ctx);
  const post = (path: string, body: unknown) => panel().request(path, { method: "POST", body: JSON.stringify(body) });

  it("rejects a key that isn't a usable private key", async () => {
    const res = await panel().request("/settings", { method: "PUT", body: JSON.stringify({ appId: "x", privateKey: "not a key" }) });
    expect(res.status).toBe(400);
    expect(getBankSettings().appId).toBe("app-1");
  });

  it("starts a consent for a bank the country offers, capped by the bank's own limit, returning to our callback", async () => {
    vi.mocked(listBanks).mockResolvedValue([{ name: "Revolut", country: "LT", maximum_consent_validity: 30 * 86_400 }]);
    vi.mocked(startAuth).mockResolvedValue({ url: "https://bank.example/consent" });
    const res = await post("/connect", { bank: "Revolut", country: "lt", origin: "https://congress.example.com" });
    expect(await res.json()).toEqual({ url: "https://bank.example/consent" });
    const input = vi.mocked(startAuth).mock.calls[0]![1];
    expect(input.redirectUrl).toBe("https://congress.example.com/congress/connectors/enablebanking/hook/callback");
    expect(Date.parse(input.validUntil) - Date.now()).toBeLessThan(30 * 86_400_000);
    expect(takePendingAuth(input.state)).toEqual({ bank: "Revolut", country: "LT" });
  });

  it("asks for as long as the bank allows, up to 180 days", async () => {
    vi.mocked(listBanks).mockResolvedValue([{ name: "Revolut", country: "LT", maximum_consent_validity: 180 * 86_400 }, { name: "Long", country: "LT", maximum_consent_validity: 400 * 86_400 }]);
    vi.mocked(startAuth).mockResolvedValue({ url: "https://bank.example/consent" });
    for (const bank of ["Revolut", "Long"]) await post("/connect", { bank, country: "LT", origin: "https://congress.example.com" });
    for (const call of vi.mocked(startAuth).mock.calls) {
      const days = (Date.parse(call[1].validUntil) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(179.9);
      expect(days).toBeLessThanOrEqual(180);
    }
  });

  it("refuses an unknown bank and a non-https origin", async () => {
    vi.mocked(listBanks).mockResolvedValue([]);
    expect((await post("/connect", { bank: "Nope", country: "SE", origin: "https://x.example" })).status).toBe(400);
    expect((await post("/connect", { bank: "Nope", country: "SE", origin: "http://evil.example" })).status).toBe(400);
    expect(startAuth).not.toHaveBeenCalled();
  });

  it("turns a returning consent into a connection with its accounts, once, and kicks off a sync", async () => {
    addPendingAuth("state-1", "Revolut", "LT");
    vi.mocked(createSession).mockResolvedValue({ session_id: "sess", accounts: [{ uid: "u1", name: "Main", currency: "EUR", account_id: { iban: "LT1" } }], aspsp: { name: "Revolut", country: "LT" }, access: { valid_until: "2027-02-01T00:00:00Z" } });
    const hooks = bankHooks(ctx);
    const res = await hooks.request("/callback?code=abc&state=state-1");
    expect(res.headers.get("location")).toBe("/settings?from=accounts&bank=connected");
    expect(listConnections()).toMatchObject([{ sessionId: "sess", bank: "Revolut", status: "active" }]);
    expect(listAccounts()).toMatchObject([{ uid: "u1", iban: "LT1", currency: "EUR" }]);
    expect(synced).toBe(1);

    const replay = await hooks.request("/callback?code=abc&state=state-1");
    expect(replay.headers.get("location")).toBe("/settings?from=accounts&bank=invalid");
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a callback with a state we never issued", async () => {
    const res = await bankHooks(ctx).request("/callback?code=abc&state=forged");
    expect(res.headers.get("location")).toBe("/settings?from=accounts&bank=invalid");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("revoking a consent stops syncing it but keeps the transactions", async () => {
    connect();
    vi.mocked(fetchTransactions).mockResolvedValue([tx("e1", "10", "2026-11-10")]);
    await syncBanks(ctx, NOW);
    expect((await panel().request("/connections/s1", { method: "DELETE" })).status).toBe(200);
    vi.mocked(fetchTransactions).mockClear();
    await syncBanks(ctx, NOW);
    expect(fetchTransactions).not.toHaveBeenCalled();
    expect(getTransactionRow("acc-1:e1")).toBeDefined();
  });
});

describe("read-only", () => {
  it("has no way to write to a bank", () => {
    expect(enableBankingConnector.push).toBeUndefined();
  });

  it("exposes a transaction as a record keyed by its id", async () => {
    connect();
    vi.mocked(fetchTransactions).mockResolvedValue([tx("e1", "12.5", "2026-11-10")]);
    await syncBanks(ctx, NOW);
    expect(enableBankingConnector.read.get("transaction", "acc-1:e1")).toMatchObject({ values: { title: "Konzum", amount: -12.5, currency: "EUR", account: "Zagrebačka banka · EUR · Main · …HR12", date: "2026-11-10" } });
    expect(enableBankingConnector.read.list("transaction", { from: "2026-11-11" })).toEqual([]);
    expect(transactionRecord(getTransactionRow("acc-1:e1")!).kind).toBe("transaction");
  });
});

describe("tools", () => {
  function tools() {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
    registerBankTools(ctx, { registerTool: (name: string, _def: unknown, fn: never) => handlers.set(name, fn) } as never);
    return async (name: string, input: Record<string, unknown> = {}) => JSON.parse((await handlers.get(name)!(input)).content[0]!.text);
  }

  // Two banks, three accounts: Sparbanken has an SEK current account and a savings account, Revolut an EUR one.
  async function threeAccounts() {
    saveConnection({
      sessionId: "sp", bank: "Sparbanken Skåne", country: "SE", validUntil: "2027-02-01T00:00:00Z",
      accounts: [{ uid: "sp-1", name: "", iban: "SE31000000007374", currency: "SEK" }, { uid: "sp-2", name: "Sparkonto", iban: "SE61000000007416", currency: "SEK" }],
    });
    saveConnection({ sessionId: "rv", bank: "Revolut", country: "LT", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "rv-1", name: "", iban: "LT45000000003206", currency: "EUR" }] });
    const sek = (id: string, amount: string, who: string, date = "2026-11-10") => tx(id, amount, date, { transaction_amount: { currency: "SEK", amount }, creditor: { name: who } });
    vi.mocked(fetchTransactions).mockImplementation(async (_c, uid) => {
      if (uid === "sp-1") return [sek("a", "200", "ICA"), sek("b", "50", "Coop")];
      if (uid === "sp-2") return [{ ...sek("c", "900", "Landlord"), credit_debit_indicator: "CRDT", debtor: { name: "Me" } }];
      return [tx("d", "12", "2026-11-11", { creditor: { name: "Spotify" } })];
    });
    await syncBanks(ctx, NOW);
  }

  it("sums spending per account, then per currency, so accounts can be told apart", async () => {
    await threeAccounts();
    const out = await tools()("banks_spending", { from: "2026-11-01", to: "2026-11-30", top: 5 });
    expect(out.accounts.map((a: { label: string }) => a.label).sort()).toEqual(["Revolut · EUR · …3206", "Sparbanken Skåne · SEK · Sparkonto · …7416", "Sparbanken Skåne · SEK · …7374"]);
    expect(out.accounts.find((a: { accountId: string }) => a.accountId === "sp-1")).toMatchObject({ bank: "Sparbanken Skåne", currency: "SEK", in: 0, out: 250, topSpending: [{ counterparty: "ICA", amount: 200 }, { counterparty: "Coop", amount: 50 }] });
    expect(out.accounts.find((a: { accountId: string }) => a.accountId === "sp-2")).toMatchObject({ in: 900, out: 0 });
    expect(out.totalsPerCurrency).toEqual(expect.arrayContaining([{ currency: "SEK", in: 900, out: 250 }, { currency: "EUR", in: 0, out: 12 }]));
  });

  it("limits to one account by id, IBAN, bank name, currency or IBAN tail", async () => {
    await threeAccounts();
    const spent = async (account: string) => (await tools()("banks_spending", { from: "2026-11-01", to: "2026-11-30", account, top: 5 })).accounts.map((a: { accountId: string }) => a.accountId).sort();
    expect(await spent("sp-1")).toEqual(["sp-1"]);
    expect(await spent("LT45000000003206")).toEqual(["rv-1"]);
    expect(await spent("revolut")).toEqual(["rv-1"]);
    expect(await spent("EUR")).toEqual(["rv-1"]);
    expect(await spent("…7416")).toEqual(["sp-2"]);
    expect(await spent("sparbanken")).toEqual(["sp-1", "sp-2"]);
    const none = await tools()("banks_spending", { from: "2026-11-01", to: "2026-11-30", account: "nordea" });
    expect(none.error).toContain("No account matches");
    expect(none.accounts).toHaveLength(3);
  });

  it("lists transactions with their account, filtered by account and text", async () => {
    await threeAccounts();
    const all = await tools()("banks_list_transactions", {});
    expect(all).toHaveLength(4);
    expect(all.find((t: { counterparty: string }) => t.counterparty === "Spotify")).toMatchObject({ account: "Revolut · EUR · …3206", accountId: "rv-1", amount: -12, currency: "EUR" });
    expect((await tools()("banks_list_transactions", { account: "sparkonto" })).map((t: { counterparty: string }) => t.counterparty)).toEqual(["Me"]);
    expect((await tools()("banks_list_transactions", { query: "ica", limit: 5 })).map((t: { counterparty: string }) => t.counterparty)).toEqual(["ICA"]);
    expect((await tools()("banks_list_transactions", { account: "nordea" })).error).toContain("No account matches");
  });

  it("gives records the same account label, not a bare name", async () => {
    await threeAccounts();
    expect(enableBankingConnector.read.get("transaction", "sp-1:a")?.values.account).toBe("Sparbanken Skåne · SEK · …7374");
  });

  it("separates income sources from spending, and keeps topping-up Revolut out of both", async () => {
    saveConnection({ sessionId: "z", bank: "Zagrebačka banka", country: "HR", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "z1", name: "", iban: "HR1", currency: "EUR" }] });
    saveConnection({ sessionId: "r", bank: "Revolut", country: "LT", validUntil: "2027-02-01T00:00:00Z", accounts: [{ uid: "r1", name: "", iban: "LT1", currency: "EUR" }] });
    const e = (id: string, amount: string, ind: string, date: string, text: string, who?: object) => ({ entry_reference: id, transaction_amount: { currency: "EUR", amount }, credit_debit_indicator: ind, booking_date: date, remittance_information: [text], ...who });
    vi.mocked(fetchTransactions).mockImplementation(async (_c, uid) =>
      uid === "z1"
        ? [e("z-rent", "850", "CRDT", "2026-10-12", "UPLATA Rent", { debtor: { name: "Zrinka" } }), e("z-top", "100", "CRDT", "2026-11-13", "Kupovina Revolut**7915* Dublin IE")]
        : [e("r-top", "100", "CRDT", "2026-11-13", "Top-up"), e("r-shop", "30", "DBIT", "2026-11-14", "x", { creditor: { name: "Konzum" } })]
    );
    await syncBanks(ctx, NOW);
    const out = await tools()("banks_spending", { from: "2026-10-01", to: "2026-11-30" });
    expect(out.totalsPerCurrency).toEqual([{ currency: "EUR", in: 850, out: 30 }]);
    expect(out.byMonth).toEqual([{ month: "2026-10", currency: "EUR", in: 850, out: 0 }, { month: "2026-11", currency: "EUR", in: 0, out: 30 }]);
    expect(out.accounts.find((a: { accountId: string }) => a.accountId === "z1")).toMatchObject({ in: 850, out: 0, topIncome: [{ counterparty: "Zrinka", amount: 850 }] });
    expect(out.accounts.find((a: { accountId: string }) => a.accountId === "r1")).toMatchObject({ topSpending: [{ counterparty: "Konzum", amount: 30 }] });
    expect(out.transfersExcluded).toEqual([{ currency: "EUR", entries: 2, movedOut: 100 }]);

    const naive = await tools()("banks_spending", { from: "2026-10-01", to: "2026-11-30", includeTransfers: true });
    expect(naive.totalsPerCurrency).toEqual([{ currency: "EUR", in: 950, out: 130 }]);

    const list = await tools()("banks_list_transactions", { direction: "out", includeTransfers: false });
    expect(list.map((t: { counterparty: string }) => t.counterparty)).toEqual(["Konzum"]);
    expect((await tools()("banks_list_transactions", {})).filter((t: { transfer: boolean }) => t.transfer)).toHaveLength(2);
  });

  it("doesn't read balances for an expired consent", async () => {
    connect("2026-01-01T00:00:00Z");
    const out = await tools()("banks_list_accounts");
    expect(out[0]).toMatchObject({ accountId: "acc-1", label: "Zagrebačka banka · EUR · Main · …HR12", consentExpired: true, balances: [] });
    expect(fetchBalances).not.toHaveBeenCalled();
  });
});
