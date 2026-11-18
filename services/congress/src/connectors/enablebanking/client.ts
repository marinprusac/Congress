import { createSign } from "node:crypto";

const BASE_URL = "https://api.enablebanking.com";

export class BankApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "BankApiError";
  }
}

export interface BankCredentials {
  appId: string;
  privateKey: string;
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

// RS256 JWT with the app id as `kid`; Enable Banking accepts up to 24 h.
export function signJwt({ appId, privateKey }: BankCredentials, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const body = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

// One readable line from Enable Banking's JSON error ({ code, message, error }), else the raw start of the body.
export function describeError(status: number, body: string): string {
  try {
    const e = JSON.parse(body) as { message?: string; error?: string };
    const parts = [e.error, e.message].filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length) return `Enable Banking ${status}: ${parts.join(" - ")}`;
  } catch {
    // Not JSON.
  }
  return `Enable Banking ${status}${body ? `: ${body.slice(0, 200)}` : ""}`;
}

async function call(creds: BankCredentials, path: string, opts: { method?: string; params?: Record<string, string>; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { Authorization: `Bearer ${signJwt(creds)}`, Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new BankApiError(describeError(res.status, text), res.status);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export interface Aspsp {
  name: string;
  country: string;
  // Seconds.
  maximum_consent_validity?: number;
}

export async function listBanks(creds: BankCredentials, country: string): Promise<Aspsp[]> {
  const body = await call(creds, "/aspsps", { params: { country, psu_type: "personal" } });
  return (body.aspsps ?? []) as Aspsp[];
}

// Starts a consent: the owner opens `url` at the bank and returns to redirectUrl with ?code&state.
export async function startAuth(creds: BankCredentials, input: { bank: string; country: string; validUntil: string; state: string; redirectUrl: string }): Promise<{ url: string }> {
  const body = await call(creds, "/auth", {
    method: "POST",
    body: {
      access: { valid_until: input.validUntil },
      aspsp: { name: input.bank, country: input.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: "personal",
    },
  });
  return { url: String(body.url) };
}

export interface RawSession {
  session_id: string;
  accounts: { uid: string; name?: string; currency?: string; account_id?: { iban?: string } }[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
}

export const createSession = async (creds: BankCredentials, code: string) => (await call(creds, "/sessions", { method: "POST", body: { code } })) as unknown as RawSession;
export const deleteSession = (creds: BankCredentials, sessionId: string) => call(creds, `/sessions/${sessionId}`, { method: "DELETE" });

export async function fetchBalances(creds: BankCredentials, accountUid: string): Promise<{ type: string; currency: string; amount: string }[]> {
  const body = await call(creds, `/accounts/${accountUid}/balances`);
  return ((body.balances ?? []) as { balance_type?: string; balance_amount?: { currency: string; amount: string } }[]).map((b) => ({
    type: b.balance_type ?? "",
    currency: b.balance_amount?.currency ?? "",
    amount: b.balance_amount?.amount ?? "",
  }));
}

// Booked transactions from `dateFrom`, following continuation keys.
export async function fetchTransactions(creds: BankCredentials, accountUid: string, dateFrom: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let key: string | undefined;
  do {
    const params: Record<string, string> = { date_from: dateFrom, transaction_status: "BOOK" };
    if (key) params.continuation_key = key;
    const body = await call(creds, `/accounts/${accountUid}/transactions`, { params });
    out.push(...((body.transactions ?? []) as unknown[]));
    key = typeof body.continuation_key === "string" && body.continuation_key ? body.continuation_key : undefined;
  } while (key);
  return out;
}
