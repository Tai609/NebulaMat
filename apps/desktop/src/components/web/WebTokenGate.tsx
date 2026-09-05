import { useState } from "react";
import { useTranslation } from "react-i18next";
import { gatewayOrigin, setGatewayToken } from "@/lib/webMode";

/** Pre-auth screen for the gateway-served web client: paste the bearer token
 *  (validated against /v1/whoami) before the real app boots. See
 *  docs/rfc/remote-access-gateway.md. */
export function WebTokenGate({ onConnect }: { onConnect: () => void }) {
  const { t } = useTranslation(["settings"]);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const tok = token.trim();
    if (!tok || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${gatewayOrigin()}/v1/whoami`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!r.ok) {
        setError(t("remote.error"));
        setBusy(false);
        return;
      }
      setGatewayToken(tok);
      onConnect();
    } catch {
      setError(t("remote.error"));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg p-6 text-text">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-7 shadow-xl">
        <h1 className="text-lg font-semibold">{t("remote.title")}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t("remote.connectPrompt")}</p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={t("remote.token")}
          className="mt-4 h-10 w-full rounded-input border border-border bg-surface-2 px-3 text-sm outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !token.trim()}
          className="mt-4 h-10 w-full rounded-input bg-accent text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {t("remote.connect")}
        </button>
      </div>
    </div>
  );
}
