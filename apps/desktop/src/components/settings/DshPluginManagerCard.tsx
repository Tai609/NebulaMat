import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Plus, Puzzle, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useRuntimeStore } from "@/lib/runtime";
import { installDshPlugin, isTauri, listDshPlugins, removeDshPlugin, setDshPlugin, type DshPlugin } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { inputCls } from "./inputCls";
import { Section, Switch } from "./Section";

const emptyConfig = "{}";

/** Manage user-owned Cordis plugins that are mounted into the DSH web profile. */
export function DshPluginManagerCard() {
  const { t } = useTranslation(["settings", "common"]);
  const connected = useRuntimeStore((s) => s.status === "ready");
  const reconnect = useRuntimeStore((s) => s.connectRetry);
  const [plugins, setPlugins] = useState<DshPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [id, setId] = useState("");
  const [module, setModule] = useState("");
  const [configText, setConfigText] = useState(emptyConfig);
  const [source, setSource] = useState("");
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(await listDshPlugins());
    } catch (error) {
      toast.error(`${t("plugins.loadFailed")}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const parseConfig = (): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(configText);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
      return value as Record<string, unknown>;
    } catch {
      toast.error(t("plugins.invalidConfig"));
      return null;
    }
  };

  const apply = async (
    pluginId: string,
    input: { module: string; enabled: boolean; config: Record<string, unknown> },
  ): Promise<boolean> => {
    setBusyId(pluginId);
    try {
      await setDshPlugin(pluginId, input);
      setPlugins((current) => {
        const next = { id: pluginId, ...input } satisfies DshPlugin;
        return current.some((plugin) => plugin.id === pluginId)
          ? current.map((plugin) => (plugin.id === pluginId ? next : plugin))
          : [...current, next].sort((a, b) => a.id.localeCompare(b.id));
      });
      // The native command restarts DSH so Cordis re-reads cordis.patch.yml.
      // Reconnect only when the app had a live stream before the edit.
      if (connected) await reconnect();
      toast.success(t("plugins.saved"));
      return true;
    } catch (error) {
      toast.error(`${t("plugins.saveFailed")}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const add = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pluginId = id.trim();
    const pluginModule = module.trim();
    const config = parseConfig();
    if (!pluginId || !pluginModule || !config) {
      if (!pluginId || !pluginModule) toast.error(t("plugins.fieldsRequired"));
      return;
    }
    const saved = await apply(pluginId, { module: pluginModule, enabled: true, config });
    if (!saved) return;
    setId("");
    setModule("");
    setConfigText(emptyConfig);
    setShowForm(false);
  };

  const install = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const spec = source.trim();
    if (!spec || installing) return;
    setInstalling(true);
    try {
      const plugin = await installDshPlugin(spec);
      await refresh();
      if (connected) await reconnect();
      setSource("");
      toast.success(t("plugins.installed", { id: plugin.id }));
    } catch (error) {
      toast.error(`${t("plugins.installFailed")}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInstalling(false);
    }
  };

  const toggle = (plugin: DshPlugin) =>
    void apply(plugin.id, { module: plugin.module, enabled: !plugin.enabled, config: plugin.config });

  const remove = async (plugin: DshPlugin) => {
    setBusyId(plugin.id);
    try {
      await removeDshPlugin(plugin.id);
      setPlugins((current) => current.filter((item) => item.id !== plugin.id));
      if (connected) await reconnect();
      toast.success(t("plugins.removed", { id: plugin.id }));
    } catch (error) {
      toast.error(`${t("plugins.removeFailed")}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title={t("plugins.title")} hint={t("plugins.hint")} flush>
      <div className="flex items-start gap-2.5 border-b border-faint bg-warn/5 px-4 py-3 text-xs leading-relaxed text-muted">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
        <p>{t("plugins.securityNote")}</p>
      </div>

      <form onSubmit={(event) => void install(event)} className="border-b border-faint p-4">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t("plugins.sourceLabel")}</span>
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={t("plugins.sourcePlaceholder")}
            className={inputCls("w-full font-mono")}
            spellCheck={false}
            disabled={!isTauri || installing}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-input bg-accent px-3 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={!isTauri || installing || !source.trim()}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {installing ? t("plugins.installing") : t("plugins.install")}
          </button>
          <span className="text-[11px] text-muted">{t("plugins.sourceHint")}</span>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          {t("plugins.loading")}
        </div>
      ) : plugins.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <Puzzle size={20} className="mx-auto text-muted" />
          <p className="mt-2 text-[13px] text-text">{t("plugins.empty")}</p>
          <p className="mt-1 text-xs text-muted">{t("plugins.emptyHint")}</p>
        </div>
      ) : (
        <div className="divide-y divide-faint">
          {plugins.map((plugin) => {
            const busy = busyId === plugin.id;
            return (
              <div key={plugin.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", plugin.enabled ? "bg-ok" : "bg-border")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="font-medium text-text">{plugin.id}</span>
                    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                      {plugin.installed ? t("plugins.installedTag") : t("plugins.thirdParty")}
                    </span>
                    {plugin.client && (
                      <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent ring-1 ring-accent/20">
                        {t("plugins.clientTag")}
                      </span>
                    )}
                    {plugin.skill && (
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                        {t("plugins.skillTag")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted" title={plugin.module}>
                    {plugin.module}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Switch
                    checked={plugin.enabled}
                    onChange={() => toggle(plugin)}
                    label={t("plugins.toggle", { id: plugin.id })}
                    disabled={busyId !== null || !isTauri}
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-input text-muted transition-colors hover:bg-error/10 hover:text-error disabled:opacity-40"
                    onClick={() => void remove(plugin)}
                    disabled={busyId !== null || !isTauri}
                    aria-label={t("plugins.remove", { id: plugin.id })}
                    title={t("plugins.remove", { id: plugin.id })}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm ? (
        <form onSubmit={(event) => void add(event)} className="space-y-3 border-t border-faint p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="mb-1 block text-xs text-muted">{t("plugins.idLabel")}</span>
              <input
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder={t("plugins.idPlaceholder")}
                className={inputCls("w-full font-mono")}
                spellCheck={false}
                autoFocus
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-xs text-muted">{t("plugins.moduleLabel")}</span>
              <input
                value={module}
                onChange={(event) => setModule(event.target.value)}
                placeholder={t("plugins.modulePlaceholder")}
                className={inputCls("w-full font-mono")}
                spellCheck={false}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t("plugins.configLabel")}</span>
            <textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              rows={5}
              spellCheck={false}
              aria-label={t("plugins.configLabel")}
              className={cn(inputCls("w-full resize-y py-2 font-mono text-[12px] leading-relaxed"))}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-input px-2.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text"
              onClick={() => setShowForm(false)}
            >
              <X size={13} /> {t("common:actions.cancel")}
            </button>
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1.5 rounded-input bg-accent px-3 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={busyId !== null || !isTauri}
            >
              {busyId === id.trim() ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {t("plugins.add")}
            </button>
          </div>
        </form>
      ) : (
        <div className="border-t border-faint p-3">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border px-3 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-40"
            onClick={() => setShowForm(true)}
            disabled={!isTauri}
          >
            <Plus size={13} /> {t("plugins.add")}
          </button>
        </div>
      )}
    </Section>
  );
}
