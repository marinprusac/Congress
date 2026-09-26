import { request } from "node:http";
import { aiRunResultSchema, aiSettingsSchema, type AiRunRequest, type AiRunResult, type AiSettings } from "@congress/shared-types";

// A Chamber's backend-side client for Congress's own AI (services/congress/
// src/ai/). Chambers never spawn `claude` themselves - they hand Congress a
// prompt and get back the finished run, queued behind every other run and
// subject to the same shared budget/pause guardrails as the owner's chat.

// POST /congress/ai/run blocks until the queued run finishes, which can take
// longer than fetch's built-in 5-minute headers timeout (a long run, or one
// queued behind others) - so this is a plain node:http request with no
// timeout of its own instead of fetch.
function postJson(url: string, token: string, body: unknown): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-Congress-Internal-Token": token,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

export async function runCongressAi(capitolUrl: string, token: string, input: AiRunRequest): Promise<AiRunResult> {
  const { status, text } = await postJson(`${capitolUrl}/congress/ai/run`, token, input);
  if (status !== 200) throw new Error(`Congress AI run failed: ${status} ${text.slice(0, 200)}`);
  return aiRunResultSchema.parse(JSON.parse(text));
}

export async function fetchCongressAiSettings(capitolUrl: string, token: string): Promise<AiSettings> {
  const res = await fetch(`${capitolUrl}/congress/ai/settings`, { headers: { "X-Congress-Internal-Token": token } });
  if (!res.ok) throw new Error(`Could not read Congress AI settings: ${res.status}`);
  return aiSettingsSchema.parse(await res.json());
}
