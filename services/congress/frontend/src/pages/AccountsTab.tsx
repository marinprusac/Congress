import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmSheet, googleConnectHref } from "@congress/congress-ui";
import type { GoogleConnectorStatus } from "@congress/shared-types";
import { disconnectGoogleAccount, fetchGoogleConnector, renameGoogleAccount } from "@/lib/connectorsApi";

type Account = GoogleConnectorStatus["accounts"][number];

function AccountRow({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(account.label);
  const [confirming, setConfirming] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["connectors", "google"] });

  const rename = useMutation({ mutationFn: () => renameGoogleAccount(account.id, label.trim()), onSuccess: () => { setRenaming(false); invalidate(); } });
  const disconnect = useMutation({ mutationFn: () => disconnectGoogleAccount(account.id), onSuccess: invalidate });
  const connectHref = googleConnectHref({ loginHint: account.email });

  return (
    <li className="border-t border-dust py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) rename.mutate();
              }}
              className="flex gap-2"
            >
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
                className="min-w-0 border border-dust bg-parchment px-2 py-1 font-mono text-base text-ink"
              />
              <button type="submit" className="font-mono text-xs uppercase text-accent">
                Save
              </button>
            </form>
          ) : (
            <span className="font-display text-lg text-ink">{account.label}</span>
          )}
          {account.label !== account.email && <p className="truncate font-mono text-xs text-dust">{account.email}</p>}
        </div>
        <div className="flex shrink-0 gap-3 font-mono text-xs uppercase tracking-wide">
          {!renaming && (
            <button type="button" onClick={() => setRenaming(true)} className="tap-target text-slate hover:underline">
              Rename
            </button>
          )}
          <button type="button" onClick={() => setConfirming(true)} className="tap-target text-alert hover:underline">
            Disconnect
          </button>
        </div>
      </div>

      {account.needsReconnect && (
        <p className="mt-2 font-mono text-xs text-alert">
          Access was revoked.{" "}
          <a href={connectHref} className="uppercase text-accent hover:underline">
            Reconnect
          </a>
        </p>
      )}
      {!account.needsReconnect &&
        account.missing.map((m) => (
          <p key={m.chamber} className="mt-2 font-mono text-xs text-dust">
            {m.displayName} needs more access.{" "}
            <a href={connectHref} className="uppercase text-accent hover:underline">
              Grant
            </a>
          </p>
        ))}

      <ConfirmSheet
        open={confirming}
        title="Disconnect account"
        message={`Disconnect ${account.email}? Every Chamber using it loses access.`}
        confirmLabel="Disconnect"
        onConfirm={() => {
          setConfirming(false);
          disconnect.mutate();
        }}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}

// Google accounts shared by every Chamber that talks to Google.
export function AccountsTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["connectors", "google"], queryFn: fetchGoogleConnector });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl text-ink">Google</h3>
        {data?.configured && (
          <a href={googleConnectHref()} className="font-mono text-xs uppercase tracking-wide text-accent hover:underline">
            + Connect account
          </a>
        )}
      </div>
      {data && data.requesters.length > 0 && (
        <p className="mb-3 font-mono text-xs text-dust">Used by {data.requesters.map((r) => r.displayName).join(", ")}.</p>
      )}
      {isLoading && <p className="font-mono text-sm text-dust">Loading —</p>}
      {isError && <p className="font-mono text-sm text-alert">Failed to load accounts.</p>}
      {data && !data.configured && (
        <p className="font-mono text-sm text-alert">Google isn't configured - set GOOGLE_OAUTH_CLIENT_ID/SECRET in Congress's .env.</p>
      )}
      {data && data.accounts.length === 0 && (
        <p className="border-t border-dust px-1 py-3 font-mono text-sm text-dust">— No Google accounts connected —</p>
      )}
      <ul>
        {data?.accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </ul>
    </div>
  );
}
