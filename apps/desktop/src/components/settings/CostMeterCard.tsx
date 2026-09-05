import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  CircleDollarSign,
  Gauge,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  TableProperties,
  Trash2,
} from "lucide-react";
import type {
  CostMeterActionResult,
  CostMeterBreakdown,
  CostMeterConfig,
  CostMeterDayUsage,
  CostMeterPrice,
  CostMeterProviderMode,
  CostMeterState,
} from "@ai4s/sdk";
import { useTranslation } from "react-i18next";
import { getClient, useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Row, Section, Switch } from "./Section";
import { inputCls, selectCls } from "./inputCls";

type ConfigPatch = Record<string, unknown>;
type PriceField = "cacheHit" | "cacheWrite" | "cacheMiss" | "output";
type CostView = "overview" | "billing" | "prices";
type RangeDays = 7 | 14 | 30 | 0;

const EMPTY_PRICE: CostMeterPrice = { cacheHit: 0, cacheMiss: 0, output: 0 };
/* eslint-disable i18next/no-literal-string -- internal billing enums and chart palette values */
const PROVIDER_MODES: CostMeterProviderMode[] = ["usage", "subscription", "free", "local"];
const CHART_COLORS = {
  spend: "#22c55e",
  input: "#06b6d4",
  cacheRead: "#f59e0b",
  output: "#8b5cf6",
} as const;
/* eslint-enable i18next/no-literal-string */

export function CostMeterCard() {
  const { t } = useTranslation(["settings", "common"]);
  const status = useRuntimeStore((s) => s.status);
  const [state, setState] = useState<CostMeterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"prices" | "history" | null>(null);
  const [modelId, setModelId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [goKey, setGoKey] = useState("");
  const [view, setView] = useState<CostView>("overview");
  const [rangeDays, setRangeDays] = useState<RangeDays>(14);

  const rangeHistory = useMemo(() => {
    const rows = [...(state?.history ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return rangeDays === 0 ? rows : rows.slice(-rangeDays);
  }, [rangeDays, state?.history]);

  const load = useCallback(async (silent = false) => {
    const client = getClient();
    if (!client?.getCostMeterState) {
      setLoading(false);
      setState(null);
      setError(t("cost.unavailable"));
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      setState(await client.getCostMeterState());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (status === "ready") void load();
    else {
      setLoading(false);
      setState(null);
    }
  }, [load, status]);

  // The ledger is updated when a model stream settles, not when the Settings
  // page is opened. Refresh a mounted card after each completed turn so
  // subscription-backed calls appear without requiring a manual click.
  useEffect(() => {
    if (status !== "ready") return undefined;
    const client = getClient();
    if (!client?.onRuntimeEvent) return undefined;
    return client.onRuntimeEvent((event) => {
      if (event.type === "session.idle") void load(true);
    });
  }, [load, status]);

  const update = async (patch: ConfigPatch, operation = "save") => {
    const client = getClient();
    if (!client?.updateCostMeterConfig || busy) return;
    setBusy(operation);
    setError(null);
    try {
      setState(await client.updateCostMeterConfig(patch));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const action = async (
    operation: string,
    run: (() => Promise<CostMeterActionResult | CostMeterState>) | undefined,
  ) => {
    if (!run || busy) return;
    setBusy(operation);
    setError(null);
    try {
      const result = await run();
      if ("ok" in result) {
        if (result.state) setState(result.state);
        if (!result.ok) setError(result.message);
      } else {
        setState(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (status !== "ready") {
    return (
      <Section title={t("cost.title")}>
        <p className="text-[13px] text-muted">{t("cost.connectPrompt")}</p>
      </Section>
    );
  }

  if (loading) {
    return (
      <Section title={t("cost.title")}>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          {t("cost.loading")}
        </div>
      </Section>
    );
  }

  if (!state) {
    return (
      <Section
        title={t("cost.title")}
        action={<IconButton label={t("cost.refresh")} onClick={() => void load()}><RefreshCw size={14} /></IconButton>}
      >
        <p className="text-[13px] text-error">{error ?? t("cost.unavailable")}</p>
      </Section>
    );
  }

  const config = state.config;
  const priceCatalog = state.priceCatalog ?? {
    fetchedAt: null,
    modelCount: 0,
    ignoredTiered: 0,
    used: [],
  };
  const client = getClient();
  const rangeUsage = aggregateDays(rangeHistory);
  const tokens = rangeUsage.input + rangeUsage.output + rangeUsage.cacheRead + rangeUsage.cacheWrite;
  const todayTokens = totalTokens(state.today);
  const monthTokens = totalTokens(state.month);
  const todayCovered = billedCost(state.today) === 0 && todayTokens > 0;
  const monthCovered = billedCost(state.month) === 0 && monthTokens > 0;
  const cacheHitRate = rangeUsage.input + rangeUsage.cacheRead > 0
    ? rangeUsage.cacheRead / (rangeUsage.input + rangeUsage.cacheRead)
    : 0;
  const yesterday = state.history.find((day) => day.date === dateKeyOffset(state.meta.dayKey, -1));
  const todayDelta = yesterday && billedCost(yesterday) > 0
    ? (billedCost(state.today) - billedCost(yesterday)) / billedCost(yesterday) * 100
    : null;
  const budgetUsed = state.budgetUsed * config.exchangeRate;
  const budgetPercent = config.budget.amount > 0 ? Math.min(999, budgetUsed / config.budget.amount * 100) : 0;

  const patchBudget = (patch: Partial<CostMeterConfig["budget"]>) =>
    update({ budget: { ...config.budget, ...patch } }, "budget");
  const patchPrices = (prices: CostMeterConfig["prices"]) => update({ prices }, "prices");
  const patchProviderModes = (providerModes: CostMeterConfig["providerModes"]) =>
    update({ providerModes }, "provider-modes");

  return (
    <>
      <Section
        title={t("cost.title")}
        hint={t("cost.updatedAt", { value: formatDateTime(state.meta.now) })}
        action={
          <div className="flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin text-muted" />}
            <IconButton label={t("cost.refresh")} onClick={() => void load()} disabled={!!busy}>
              <RefreshCw size={14} />
            </IconButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3 border-b border-faint pb-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            label={t("cost.views.label")}
            value={view}
            options={[
              { value: "overview", label: t("cost.views.overview"), icon: <Activity size={13} /> },
              { value: "billing", label: t("cost.views.billing"), icon: <SlidersHorizontal size={13} /> },
              { value: "prices", label: t("cost.views.prices"), icon: <TableProperties size={13} /> },
            ]}
            onChange={setView}
          />
          {view === "overview" && (
            <SegmentedControl
              compact
              label={t("cost.range.label")}
              value={rangeDays}
              options={[
                { value: 7, label: t("cost.range.days", { count: 7 }) },
                { value: 14, label: t("cost.range.days", { count: 14 }) },
                { value: 30, label: t("cost.range.days", { count: 30 }) },
                { value: 0, label: t("cost.range.all") },
              ]}
              onChange={setRangeDays}
            />
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label={t("cost.today")}
            value={todayCovered ? formatTokens(todayTokens) : money(billedCost(state.today), config)}
            detail={todayCovered
              ? (todayDelta === null
                ? String(t("cost.calls", { count: state.today.calls }))
                : t("cost.delta", { value: `${todayDelta >= 0 ? "+" : ""}${todayDelta.toFixed(1)}%` }))
              : t("cost.coveredUsage", { calls: state.today.calls, tokens: formatTokens(todayTokens) })}
          />
          <Metric
            label={t("cost.month")}
            value={monthCovered ? formatTokens(monthTokens) : money(billedCost(state.month), config)}
            detail={monthCovered
              ? (config.budget.enabled
                ? t("cost.budget.percent", { value: budgetPercent.toFixed(1) })
                : String(t("cost.calls", { count: state.month.calls })))
              : t("cost.coveredUsage", { calls: state.month.calls, tokens: formatTokens(monthTokens) })}
          />
          <Metric label={t("cost.listValue")} value={money(state.month.cost, config)} detail={t("cost.month")} />
          <Metric label={t("cost.savings")} value={money(state.month.savings, config)} detail={t("cost.billingModes.covered")} />
          <Metric
            label={t("cost.cacheHitRate")}
            value={`${(cacheHitRate * 100).toFixed(1)}%`}
            detail={t("cost.range.tokens", { value: formatTokens(tokens) })}
          />
        </div>
        {error && <p className="mt-3 text-xs text-error">{error}</p>}
      </Section>

      {view === "overview" && (
        <>
          <Section title={t("cost.trends.title")} hint={t("cost.trends.range", { count: rangeHistory.length })}>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <TrendChart
                title={t("cost.trends.cost")}
                rows={rangeHistory}
                series={[{ label: t("cost.actualSpend"), color: CHART_COLORS.spend, values: rangeHistory.map(billedCost) }]}
                formatValue={(value) => money(value, config)}
              />
              <TrendChart
                title={t("cost.trends.tokens")}
                rows={rangeHistory}
                series={[
                  { label: t("cost.usage.input"), color: CHART_COLORS.input, values: rangeHistory.map((day) => day.input) },
                  { label: t("cost.usage.cacheRead"), color: CHART_COLORS.cacheRead, values: rangeHistory.map((day) => day.cacheRead) },
                  { label: t("cost.usage.output"), color: CHART_COLORS.output, values: rangeHistory.map((day) => day.output) },
                ]}
                formatValue={formatTokens}
              />
            </div>
          </Section>

          <Section title={t("cost.breakdown.title")}>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <BreakdownList title={t("cost.breakdown.models")} rows={rangeUsage.models} config={config} />
              <BreakdownList title={t("cost.breakdown.providers")} rows={rangeUsage.providers} config={config} showMode />
            </div>
          </Section>
        </>
      )}

      {view === "billing" && <Section title={t("cost.budget.title")} flush>
        <Row
          title={t("cost.budget.enabled")}
          control={
            <Switch
              checked={config.budget.enabled}
              onChange={(enabled) => void patchBudget({ enabled })}
              label={t("cost.budget.enabled")}
              disabled={!!busy}
            />
          }
        >
          {config.budget.enabled && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full", budgetPercent >= 100 ? "bg-error" : budgetPercent >= 80 ? "bg-warn" : "bg-accent")}
                  style={{ width: `${Math.min(100, budgetPercent)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                {t("cost.budget.status", {
                  used: `${config.symbol}${budgetUsed.toFixed(config.decimals)}`,
                  limit: `${config.symbol}${config.budget.amount.toFixed(config.decimals)}`,
                  percent: budgetPercent.toFixed(1),
                })}
              </p>
            </div>
          )}
        </Row>
        {config.budget.enabled && (
          <div className="grid grid-cols-1 gap-3 border-t border-faint px-4 py-3 sm:grid-cols-2">
            <Field label={t("cost.budget.amount")}>
              <input
                type="number"
                min={0}
                step="0.01"
                defaultValue={config.budget.amount}
                className={inputCls("w-full tabular-nums")}
                onBlur={(event) => void patchBudget({ amount: Math.max(0, Number(event.currentTarget.value) || 0) })}
              />
            </Field>
            <Field label={t("cost.budget.period")}>
              <select
                value={config.budget.period}
                className={selectCls("w-full")}
                onChange={(event) => void patchBudget({ period: event.target.value as CostMeterConfig["budget"]["period"] })}
              >
                <option value="day">{t("cost.budget.day")}</option>
                <option value="month">{t("cost.budget.month")}</option>
                <option value="all">{t("cost.budget.all")}</option>
                <option value="custom">{t("cost.budget.custom")}</option>
              </select>
            </Field>
            {config.budget.period === "custom" && (
              <>
                <Field label={t("cost.budget.start")}>
                  <input type="date" value={config.budget.customStart ?? ""} className={inputCls("w-full")} onChange={(e) => void patchBudget({ customStart: e.target.value || null })} />
                </Field>
                <Field label={t("cost.budget.end")}>
                  <input type="date" value={config.budget.customEnd ?? ""} className={inputCls("w-full")} onChange={(e) => void patchBudget({ customEnd: e.target.value || null })} />
                </Field>
              </>
            )}
          </div>
        )}
      </Section>}

      {view === "billing" && <Section title={t("cost.account.title")} flush>
        <Row
          title={t("cost.account.balanceEnabled")}
          control={
            <Switch
              checked={config.balance.display !== "off"}
              // eslint-disable-next-line i18next/no-literal-string -- runtime enum and operation id
              onChange={(enabled) => void update({ balance: { ...config.balance, display: enabled ? "settings" : "off" } }, "balance-config")}
              label={t("cost.account.balanceEnabled")}
              disabled={!!busy}
            />
          }
        />
        {config.balance.display !== "off" && state.balance.status !== "off" && (
          <AccountRow
            icon={<CircleDollarSign size={15} />}
            title={t("cost.account.balance")}
            value={state.balance.status === "ok"
              ? `${state.balance.currency} ${state.balance.totalBalance.toFixed(Math.max(2, config.decimals))}`
              : state.balance.message || t("cost.account.notAvailable")}
            status={state.balance.status}
            action={
              <IconButton
                label={t("cost.account.refreshBalance")}
                disabled={!!busy}
                // eslint-disable-next-line i18next/no-literal-string -- operation id
                onClick={() => void action("balance", client?.refreshCostMeterBalance?.bind(client))}
              ><RefreshCw size={13} /></IconButton>
            }
          />
        )}
        {config.goQuota.enabled && state.goQuota.status !== "off" && (
          <AccountRow
            icon={<Gauge size={15} />}
            title={t("cost.account.goQuota")}
            value={<QuotaSummary state={state} />}
            status={state.goQuota.status}
            action={
              <IconButton
                label={t("cost.account.refreshQuota")}
                disabled={!!busy}
                // eslint-disable-next-line i18next/no-literal-string -- operation id
                onClick={() => void action("quota", client?.refreshCostMeterGoQuota?.bind(client))}
              ><RefreshCw size={13} /></IconButton>
            }
          />
        )}
        <Row
          title={t("cost.account.goEnabled")}
          // eslint-disable-next-line i18next/no-literal-string -- operation id
          control={<Switch checked={config.goQuota.enabled} onChange={(enabled) => void update({ goQuota: { ...config.goQuota, enabled } }, "quota-config")} label={t("cost.account.goEnabled")} disabled={!!busy} />}
        />
        {config.goQuota.enabled && (
          <Row
            title={t("cost.account.goKey")}
            control={
              <div className="flex w-full max-w-sm gap-2 sm:w-80">
                <div className="relative min-w-0 flex-1">
                  <KeyRound size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
                  <input
                    type="password"
                    value={goKey}
                    onChange={(event) => setGoKey(event.target.value)}
                    placeholder={config.goQuota.apiKey ? t("cost.account.keyStored") : t("cost.account.keyAuto")}
                    className={inputCls("w-full pl-8")}
                    autoComplete="off"
                  />
                </div>
                <IconButton
                  label={t("common:actions.save")}
                  disabled={!goKey || !!busy}
                  onClick={() => {
                    // eslint-disable-next-line i18next/no-literal-string -- operation id
                    void update({ goQuota: { ...config.goQuota, apiKey: goKey } }, "go-key").then(() => setGoKey(""));
                  }}
                ><Check size={14} /></IconButton>
              </div>
            }
          />
        )}
      </Section>}

      {view === "billing" && (
        <Section title={t("cost.billingModes.title")} flush>
          <div className="divide-y divide-faint">
            {Object.entries(config.providerModes).map(([provider, mode]) => (
              <div key={provider} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={provider}>{provider}</span>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={t("cost.billingModes.modeFor", { provider })}
                    value={mode}
                    className={selectCls("w-36")}
                    disabled={!!busy}
                    onChange={(event) => void patchProviderModes({
                      ...config.providerModes,
                      [provider]: event.target.value as CostMeterProviderMode,
                    })}
                  >
                    {PROVIDER_MODES.map((value) => (
                      <option key={value} value={value}>{t(`cost.billingModes.${value}`)}</option>
                    ))}
                  </select>
                  <IconButton
                    label={t("cost.billingModes.remove", { provider })}
                    disabled={!!busy}
                    onClick={() => {
                      const next = { ...config.providerModes };
                      delete next[provider];
                      void patchProviderModes(next);
                    }}
                  ><Trash2 size={12} /></IconButton>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-faint px-4 py-3 sm:flex-row">
            <input
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              placeholder={t("cost.billingModes.providerPlaceholder")}
              className={inputCls("min-w-0 flex-1 font-mono")}
            />
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-50"
              disabled={!providerId.trim() || !!busy}
              onClick={() => {
                const provider = providerId.trim();
                void patchProviderModes({ ...config.providerModes, [provider]: PROVIDER_MODES[0] });
                setProviderId("");
              }}
            ><Plus size={13} /> {t("cost.billingModes.add")}</button>
          </div>
        </Section>
      )}

      {view === "overview" && <Section title={t("cost.usage.title")}>
        <UsageHeatmap history={state.history} now={state.meta.now} config={config} />
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <TokenStat label={t("cost.usage.input")} value={state.total.input} />
          <TokenStat label={t("cost.usage.cacheRead")} value={state.total.cacheRead} />
          <TokenStat label={t("cost.usage.cacheWrite")} value={state.total.cacheWrite} />
          <TokenStat label={t("cost.usage.output")} value={state.total.output} />
        </div>
      </Section>}

      {view === "billing" && <Section title={t("cost.display.title")} flush>
        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t("cost.display.currency")}>
            <select
              value={["CNY", "USD", "EUR"].includes(config.currency) ? config.currency : "custom"}
              className={selectCls("w-full")}
              onChange={(event) => {
                const preset = event.target.value;
                if (preset === "CNY") void update({ currency: "CNY", symbol: "¥", decimals: 4, exchangeRate: 7.2 });
                else if (preset === "USD") void update({ currency: "USD", symbol: "$", decimals: 6, exchangeRate: 1 });
                else if (preset === "EUR") void update({ currency: "EUR", symbol: "€", decimals: 6, exchangeRate: 0.92 });
                else void update({ currency: "custom" });
              }}
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="custom">{t("cost.display.custom")}</option>
            </select>
          </Field>
          <Field label={t("cost.display.symbol")}>
            <input key={`symbol:${config.symbol}`} defaultValue={config.symbol} className={inputCls("w-full")} onBlur={(e) => void update({ symbol: e.currentTarget.value })} />
          </Field>
          <Field label={t("cost.display.exchangeRate")}>
            <input key={`exchange-rate:${config.exchangeRate}`} type="number" min={0.000001} step="0.01" defaultValue={config.exchangeRate} className={inputCls("w-full tabular-nums")} onBlur={(e) => void update({ exchangeRate: Number(e.currentTarget.value) || 1 })} />
          </Field>
          <Field label={t("cost.display.decimals")}>
            <input key={`decimals:${config.decimals}`} type="number" min={0} max={10} defaultValue={config.decimals} className={inputCls("w-full tabular-nums")} onBlur={(e) => void update({ decimals: Math.max(0, Math.min(10, Number(e.currentTarget.value) || 0)) })} />
          </Field>
        </div>
        <Row
          title={t("cost.display.peak")}
          // eslint-disable-next-line i18next/no-literal-string -- operation id
          control={<Switch checked={config.peakEnabled} onChange={(peakEnabled) => void update({ peakEnabled }, "peak")} label={t("cost.display.peak")} disabled={!!busy} />}
        />
        {config.peakEnabled && (
          <div className="grid grid-cols-1 gap-3 border-t border-faint px-4 py-3 sm:grid-cols-2">
            <Field label={t("cost.display.effectiveAt")}>
              <input defaultValue={config.peakEffectiveAt} className={inputCls("w-full font-mono")} onBlur={(e) => void update({ peakEffectiveAt: e.currentTarget.value })} />
            </Field>
            <Field label={t("cost.display.peakWindows")}>
              <input
                defaultValue={config.peakWindows.map((window) => `${window.start}-${window.end}`).join(", ")}
                className={inputCls("w-full font-mono")}
                onBlur={(event) => {
                  const peakWindows = parseWindows(event.currentTarget.value);
                  if (peakWindows) void update({ peakWindows });
                  else setError(t("cost.display.invalidWindows"));
                }}
              />
            </Field>
          </div>
        )}
      </Section>}

      {view === "prices" && <Section
        title={t("cost.prices.title")}
        hint={t("cost.prices.source", { source: config.priceSource, date: config.fetchedAt ? formatDateTime(config.fetchedAt) : t("cost.prices.bundled") })}
        action={
          <button className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-50" disabled={!!busy} onClick={() => setConfirm("prices")}>
            <RefreshCw size={13} /> {t("cost.prices.sync")}
          </button>
        }
        flush
      >
        <div className="border-b border-faint px-4 py-2.5 text-xs text-muted">
          <span>{t("cost.prices.catalogSummary", {
            count: priceCatalog.modelCount,
            date: priceCatalog.fetchedAt ? formatDateTime(priceCatalog.fetchedAt) : t("cost.prices.notSynced"),
          })}</span>
          {priceCatalog.ignoredTiered > 0 && (
            <span className="ml-2 text-warning">{t("cost.prices.tierNote", { count: priceCatalog.ignoredTiered })}</span>
          )}
        </div>
        <PriceTable
          key={JSON.stringify(config.prices)}
          config={config}
          catalogRows={priceCatalog.used}
          onChange={patchPrices}
          onRemove={(id) => {
            const models = { ...config.prices.models };
            delete models[id];
            void patchPrices({ ...config.prices, models });
          }}
        />
        <div className="flex flex-col gap-2 border-t border-faint px-4 py-3 sm:flex-row">
          <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder={t("cost.prices.modelPlaceholder")} className={inputCls("min-w-0 flex-1 font-mono")} />
          <button
            className="flex items-center justify-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-50"
            disabled={!modelId.trim() || !!busy}
            onClick={() => {
              const id = modelId.trim();
              void patchPrices({ ...config.prices, models: { ...config.prices.models, [id]: { ...EMPTY_PRICE } } });
              setModelId("");
            }}
          ><Plus size={13} /> {t("cost.prices.addModel")}</button>
        </div>
      </Section>}

      {view === "overview" && <Section title={t("cost.sessions.title")} flush>
        <UsageTable rows={state.today.sessions} config={config} session />
      </Section>}

      {view === "overview" && <Section
        title={t("cost.history.title")}
        action={
          <button className="flex items-center gap-1.5 rounded-input border border-error/30 px-2.5 py-1.5 text-xs text-error hover:bg-error/5 disabled:opacity-50" disabled={!!busy} onClick={() => setConfirm("history")}>
            <Trash2 size={13} /> {t("cost.history.clear")}
          </button>
        }
        flush
      >
        <UsageTable rows={state.history} config={config} />
      </Section>}

      {confirm === "prices" && (
        <ConfirmDialog
          title={t("cost.prices.confirmTitle")}
          body={t("cost.prices.confirmBody")}
          confirmLabel={t("cost.prices.sync")}
          onConfirm={() => {
            setConfirm(null);
            // eslint-disable-next-line i18next/no-literal-string -- operation id
            void action("sync", client?.fetchCostMeterPrices?.bind(client));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "history" && (
        <ConfirmDialog
          title={t("cost.history.confirmTitle")}
          body={t("cost.history.confirmBody")}
          confirmLabel={t("cost.history.clear")}
          onConfirm={() => {
            setConfirm(null);
            // eslint-disable-next-line i18next/no-literal-string -- operation id
            void action("reset", client?.resetCostMeterHistory?.bind(client));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex min-w-0 overflow-x-auto rounded-input border border-border bg-surface-2 p-0.5"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex shrink-0 items-center justify-center gap-1.5 rounded-[4px] text-xs transition-colors",
            compact ? "h-7 px-2" : "h-8 px-3",
            value === option.value
              ? "bg-surface text-text shadow-sm"
              : "text-muted hover:text-text",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface TrendSeries {
  label: string;
  color: string;
  values: number[];
}

function TrendChart({
  title,
  rows,
  series,
  formatValue,
}: {
  title: string;
  rows: CostMeterDayUsage[];
  series: TrendSeries[];
  formatValue: (value: number) => string;
}) {
  const { t } = useTranslation("settings");
  const width = 560;
  const height = 176;
  const left = 10;
  const right = 10;
  const top = 12;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(0, ...series.flatMap((item) => item.values));
  const x = (index: number) => rows.length <= 1 ? width / 2 : left + index / (rows.length - 1) * plotWidth;
  const y = (value: number) => top + plotHeight - (max > 0 ? value / max * plotHeight : 0);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-text">{title}</h3>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
          {series.map((item) => (
            <span key={item.label} className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-44 items-center justify-center border-y border-faint text-xs text-muted">
          {t("cost.trends.empty")}
        </div>
      ) : (
        <svg
          className="block h-44 w-full border-y border-faint"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          preserveAspectRatio="none"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={left}
              x2={width - right}
              y1={top + ratio * plotHeight}
              y2={top + ratio * plotHeight}
              stroke="currentColor"
              className="text-faint"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((item) => {
            const points = item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
            return (
              <g key={item.label}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {item.values.map((value, index) => (
                  <g key={`${item.label}:${rows[index]?.date}`}>
                    <circle cx={x(index)} cy={y(value)} r="2" fill={item.color} />
                    <circle cx={x(index)} cy={y(value)} r="6" fill="transparent">
                      <title>{`${rows[index]?.date} · ${item.label}: ${formatValue(value)}`}</title>
                    </circle>
                  </g>
                ))}
              </g>
            );
          })}
          <text x={left} y={height - 6} fill="currentColor" className="text-muted" fontSize="10">
            {rows[0]?.date.slice(5)}
          </text>
          <text x={width - right} y={height - 6} fill="currentColor" className="text-muted" fontSize="10" textAnchor="end">
            {rows[rows.length - 1]?.date.slice(5)}
          </text>
        </svg>
      )}
    </div>
  );
}

function BreakdownList({
  title,
  rows,
  config,
  showMode = false,
}: {
  title: string;
  rows: CostMeterBreakdown[];
  config: CostMeterConfig;
  showMode?: boolean;
}) {
  const { t } = useTranslation("settings");
  const ordered = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 8);
  const max = Math.max(0, ...ordered.map((row) => row.cost));
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium text-text">{title}</h3>
      {ordered.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center border-y border-faint text-xs text-muted">
          {t("cost.breakdown.empty")}
        </div>
      ) : (
        <div className="divide-y divide-faint border-y border-faint">
          {ordered.map((row) => (
            <div key={row.id} className="py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {showMode && <ModeBadge mode={row.mode} />}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={row.id}>{row.id}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-text">{money(row.billedCost, config)}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted">
                {t("cost.breakdown.tokens", { value: formatTokens(totalTokens(row)) })}
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${max > 0 ? Math.max(2, row.cost / max * 100) : 0}%` }} />
              </div>
              <div className="mt-1 flex justify-between gap-3 text-[10px] text-muted">
                <span>{t("cost.calls", { count: row.calls })}</span>
                <span className="truncate text-right">
                  {row.savings > 0
                    ? t("cost.breakdown.valueSaved", { value: money(row.cost, config), saved: money(row.savings, config) })
                    : t("cost.breakdown.listValue", { value: money(row.cost, config) })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: CostMeterProviderMode }) {
  const { t } = useTranslation("settings");
  return (
    <span className={cn(
      "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
      mode === "usage" && "border-border text-muted",
      mode === "subscription" && "border-violet-500/40 text-violet-500",
      mode === "free" && "border-cyan-500/40 text-cyan-500",
      mode === "local" && "border-emerald-500/40 text-emerald-500",
    )}>
      {t(`cost.billingModes.${mode}`)}
    </span>
  );
}

function billedCost(row: Pick<CostMeterDayUsage, "cost" | "billedCost">): number {
  return Number.isFinite(Number(row.billedCost)) ? Number(row.billedCost) : Number(row.cost) || 0;
}

function totalTokens(row: Pick<CostMeterDayUsage, "input" | "output" | "cacheRead" | "cacheWrite">): number {
  return row.input + row.output + row.cacheRead + row.cacheWrite;
}

function aggregateBreakdowns(target: CostMeterBreakdown[], source: CostMeterBreakdown[]) {
  for (const incoming of source ?? []) {
    let row = target.find((item) => item.id === incoming.id);
    if (!row) {
      row = {
        id: incoming.id,
        mode: incoming.mode ?? "usage",
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        calls: 0,
        cost: 0,
        billedCost: 0,
        savings: 0,
      };
      target.push(row);
    }
    row.mode = incoming.mode ?? row.mode;
    row.input += incoming.input ?? 0;
    row.output += incoming.output ?? 0;
    row.cacheRead += incoming.cacheRead ?? 0;
    row.cacheWrite += incoming.cacheWrite ?? 0;
    row.calls += incoming.calls ?? 0;
    row.cost += incoming.cost ?? 0;
    row.billedCost += incoming.billedCost ?? incoming.cost ?? 0;
    row.savings += incoming.savings ?? Math.max(0, (incoming.cost ?? 0) - (incoming.billedCost ?? incoming.cost ?? 0));
  }
}

function aggregateDays(rows: CostMeterDayUsage[]): CostMeterDayUsage {
  const result: CostMeterDayUsage = {
    date: "range",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: 0,
    cost: 0,
    billedCost: 0,
    savings: 0,
    models: [],
    providers: [],
    sessions: [],
  };
  for (const row of rows) {
    result.input += row.input ?? 0;
    result.output += row.output ?? 0;
    result.cacheRead += row.cacheRead ?? 0;
    result.cacheWrite += row.cacheWrite ?? 0;
    result.calls += row.calls ?? 0;
    result.cost += row.cost ?? 0;
    result.billedCost += billedCost(row);
    result.savings += row.savings ?? Math.max(0, (row.cost ?? 0) - billedCost(row));
    aggregateBreakdowns(result.models, row.models ?? []);
    aggregateBreakdowns(result.providers, row.providers ?? []);
  }
  return result;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-card border border-faint bg-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted" title={detail}>{detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 text-xs text-muted"><span className="mb-1 block">{label}</span>{children}</label>;
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-input border border-border p-1.5 text-text hover:bg-surface-2 disabled:opacity-40">{children}</button>;
}

function AccountRow({ icon, title, value, status, action }: { icon: React.ReactNode; title: string; value: React.ReactNode; status: string; action: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-faint px-4 py-3">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text">{title}</p>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status === "ok" ? "bg-ok" : status === "error" ? "bg-error" : "bg-muted")} />
          <span className="min-w-0 truncate">{value}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

function QuotaSummary({ state }: { state: CostMeterState }) {
  const { t } = useTranslation("settings");
  if (state.goQuota.status !== "ok") return <>{state.goQuota.message || t("cost.account.notAvailable")}</>;
  const values = [
    [t("cost.account.rolling"), state.goQuota.rolling],
    [t("cost.account.weekly"), state.goQuota.weekly],
    [t("cost.account.monthly"), state.goQuota.monthly],
  ] as const;
  return <>{values.filter(([, item]) => item).map(([label, item]) => `${label} ${Math.max(0, Math.min(100, item!.percent)).toFixed(0)}%`).join(" · ")}</>;
}

function UsageHeatmap({ history, now, config }: { history: CostMeterDayUsage[]; now: number; config: CostMeterConfig }) {
  const { t } = useTranslation("settings");
  const byDate = useMemo(() => new Map(history.map((day) => [day.date, day])), [history]);
  const dayCount = Math.max(7, Math.min(3650, Number(config.historyDays) || 180));
  const cells = useMemo(() => {
    // Use the ledger snapshot clock, not the browser clock. The runtime can
    // be remote or cross a local midnight while this page is open.
    const end = new Date(now);
    const start = new Date(end);
    start.setDate(end.getDate() - (dayCount - 1));
    const result: Array<{ key: string; day?: CostMeterDayUsage }> = [];
    for (let index = 0; index < dayCount; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDateKey(date);
      result.push({ key, day: byDate.get(key) });
    }
    return result;
  }, [byDate, dayCount, now]);
  const tokenTotal = (day: CostMeterDayUsage | undefined) => day === undefined
    ? 0
    : day.input + day.output + day.cacheRead + day.cacheWrite;
  const max = Math.max(0, ...cells.map((cell) => tokenTotal(cell.day)));
  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" aria-label={t("cost.usage.heatmap")}>
        {cells.map(({ key, day }) => {
          const tokens = tokenTotal(day);
          const ratio = max > 0 ? tokens / max : 0;
          return <span key={key} title={`${key} · ${formatTokens(tokens)} · ${money(day ? billedCost(day) : 0, config)}`} className="h-3 w-3 rounded-[2px] border border-faint bg-accent" style={{ opacity: ratio === 0 ? 0.12 : 0.25 + ratio * 0.75 }} />;
        })}
      </div>
    </div>
  );
}

function TokenStat({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3 border-b border-faint pb-1"><span className="text-muted">{label}</span><span className="font-mono tabular-nums text-text">{formatTokens(value)}</span></div>;
}

/* eslint-disable i18next/no-literal-string -- table field/group keys are internal enums, not UI copy */
function PriceTable({ config, catalogRows, onChange, onRemove }: {
  config: CostMeterConfig;
  catalogRows: CostMeterState["priceCatalog"]["used"];
  onChange: (prices: CostMeterConfig["prices"]) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation("settings");
  const rows: Array<{ id: string; price: CostMeterPrice; editable: boolean; source?: string }> = [
    { id: "default", price: config.prices.default, editable: true },
    ...Object.entries(config.prices.models).map(([id, price]) => ({ id, price, editable: true })),
    ...catalogRows.map(({ id, price, source }) => ({ id, price, source, editable: false })),
  ];
  const setValue = (id: string, group: "base" | "offPeak" | "peak", field: PriceField, value: number) => {
    const current = id === "default" ? config.prices.default : config.prices.models[id];
    const next = { ...current };
    delete next.source;
    if (group === "base") next[field] = value;
    else next[group] = { ...(next[group] ?? EMPTY_PRICE), [field]: value };
    if (id === "default") onChange({ ...config.prices, default: next });
    else onChange({ ...config.prices, models: { ...config.prices.models, [id]: next } });
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1240px] text-left text-xs">
        <thead className="bg-surface-2 text-muted">
          <tr>
            <th rowSpan={2} className="px-3 py-2 font-medium">{t("cost.prices.model")}</th>
            <th colSpan={4} className="border-l border-faint px-2 py-1.5 text-center font-medium">{t("cost.prices.base")}</th>
            <th colSpan={4} className="border-l border-faint px-2 py-1.5 text-center font-medium">{t("cost.prices.offPeak")}</th>
            <th colSpan={4} className="border-l border-faint px-2 py-1.5 text-center font-medium">{t("cost.prices.peak")}</th>
            <th rowSpan={2} className="w-10" />
          </tr>
          <tr>{["base", "offPeak", "peak"].flatMap((group) => (["cacheHit", "cacheWrite", "cacheMiss", "output"] as PriceField[]).map((field) => <th key={`${group}:${field}`} className="border-l border-faint px-2 py-1.5 text-right font-normal">{t(`cost.prices.${field}`)}</th>))}</tr>
        </thead>
        <tbody className="divide-y divide-faint">
          {rows.map(({ id, price, source, editable }) => (
            <tr key={id}>
              <td className="max-w-[220px] px-3 py-2 font-mono text-text" title={id}>
                <span className="block truncate">{id === "default" ? t("cost.prices.default") : id}</span>
                {source && <span className="font-sans text-[10px] text-muted">{source}</span>}
              </td>
              {(["base", "offPeak", "peak"] as const).flatMap((group) => (["cacheHit", "cacheWrite", "cacheMiss", "output"] as PriceField[]).map((field) => {
                const tier = group === "base" ? price : price[group] ?? price;
                const value = field === "cacheWrite" ? tier.cacheWrite ?? tier.cacheHit : tier[field];
                return <td key={`${group}:${field}`} className="border-l border-faint px-1.5 py-1">{editable
                  ? <input aria-label={`${id} ${group} ${field}`} type="number" min={0} step="0.01" defaultValue={value} className="h-7 w-20 rounded-input border border-transparent bg-transparent px-1.5 text-right font-mono tabular-nums text-text hover:border-border focus:border-accent focus:outline-none" onBlur={(event) => setValue(id, group, field, Math.max(0, Number(event.currentTarget.value) || 0))} />
                  : <span className="block px-1.5 text-right font-mono tabular-nums text-text">{value}</span>}</td>;
              }))}
              <td className="px-2 text-right">{editable && id !== "default" && <IconButton label={t("cost.prices.removeModel")} onClick={() => onRemove(id)}><Trash2 size={12} /></IconButton>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
/* eslint-enable i18next/no-literal-string */

function UsageTable({ rows, config, session = false }: { rows: Array<CostMeterDayUsage | CostMeterDayUsage["sessions"][number]>; config: CostMeterConfig; session?: boolean }) {
  const { t } = useTranslation("settings");
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-xs text-muted">{t(session ? "cost.sessions.empty" : "cost.history.empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-xs">
        <thead className="bg-surface-2 text-muted"><tr>
          <th className="px-4 py-2 font-medium">{t(session ? "cost.sessions.session" : "cost.history.date")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("cost.history.calls")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("cost.usage.input")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("cost.usage.cache")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("cost.usage.output")}</th>
          <th className="px-4 py-2 text-right font-medium">{t("cost.history.cost")}</th>
        </tr></thead>
        <tbody className="divide-y divide-faint">
          {rows.map((row) => <tr key={"id" in row ? row.id : row.date} className="text-text">
            <td className="max-w-[260px] truncate px-4 py-2 font-mono" title={"id" in row ? row.id : row.date}>{"id" in row ? row.id : row.date}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.calls}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTokens(row.input)}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTokens(row.cacheRead + row.cacheWrite)}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTokens(row.output)}</td>
            <td
              className="px-4 py-2 text-right font-mono tabular-nums"
              title={row.savings > 0 ? t("cost.breakdown.valueSaved", {
                value: money(row.cost, config),
                saved: money(row.savings, config),
              }) : undefined}
            >
              {money(row.billedCost, config)}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function money(usd: number, config: CostMeterConfig): string {
  const value = usd * config.exchangeRate;
  const decimals = Math.max(0, Math.min(10, Number(config.decimals) || 0));
  // Token charges are often below one cent. Keep the configured precision for
  // ordinary amounts, but add two places for a non-zero amount that would
  // otherwise be rendered as zero.
  const precision = value !== 0 && Math.abs(value) < 10 ** -decimals
    ? Math.min(10, decimals + 2)
    : decimals;
  return `${config.symbol}${value.toFixed(precision)}`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function localDateKey(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function dateKeyOffset(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return key;
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function parseWindows(value: string): Array<{ start: number; end: number }> | null {
  const windows = value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^(\d{1,2}(?:\.\d+)?)\s*-\s*(\d{1,2}(?:\.\d+)?)$/.exec(part);
    return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
  });
  return windows.length > 0 && windows.every((window) => window && window.start >= 0 && window.end <= 24 && window.start < window.end)
    ? windows as Array<{ start: number; end: number }>
    : null;
}
