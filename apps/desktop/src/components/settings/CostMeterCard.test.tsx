import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostMeterBreakdown, CostMeterDayUsage, CostMeterState } from "@ai4s/sdk";
import i18n from "@/i18n";
import * as runtime from "@/lib/runtime";
import { useRuntimeStore } from "@/lib/runtime";
import { CostMeterCard } from "./CostMeterCard";

const usage = (date: string, cost: number, calls: number): CostMeterDayUsage => {
  const breakdown: CostMeterBreakdown = {
    id: "deepseek/deepseek-chat",
    mode: "usage",
    input: 1_000,
    output: 250,
    cacheRead: 500,
    cacheWrite: 100,
    calls,
    cost,
    billedCost: cost,
    savings: 0,
  };
  return {
    date,
    input: 1_000,
    output: 250,
    cacheRead: 500,
    cacheWrite: 100,
    calls,
    cost,
    billedCost: cost,
    savings: 0,
    models: [breakdown],
    providers: [{ ...breakdown, id: "deepseek" }],
    sessions: [],
  };
};

const baseState: CostMeterState = {
  today: usage("2026-08-17", 1.25, 2),
  month: usage("2026-08", 4.5, 6),
  total: usage("all", 8.75, 10),
  budgetUsed: 1.25,
  balance: {
    status: "off",
    message: "",
    fetchedAt: 0,
    currency: "CNY",
    totalBalance: 0,
    grantedBalance: 0,
    toppedUpBalance: 0,
  },
  goQuota: {
    status: "off",
    message: "",
    fetchedAt: 0,
    rolling: null,
    weekly: null,
    monthly: null,
  },
  history: [usage("2026-08-17", 1.25, 2)],
  priceCatalog: {
    fetchedAt: "2026-08-17T03:00:00.000Z",
    modelCount: 6856,
    ignoredTiered: 12,
    used: [],
  },
  config: {
    locale: "auto",
    position: "off",
    sidebar: false,
    currency: "USD",
    symbol: "$",
    decimals: 2,
    exchangeRate: 1,
    peakEnabled: false,
    peakEffectiveAt: "",
    peakWindows: [{ start: 8, end: 12 }],
    providerModes: { "opencode-go": "subscription" },
    prices: {
      default: { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
      models: {},
    },
    budget: {
      enabled: false,
      amount: 10,
      period: "month",
      customStart: null,
      customEnd: null,
      detail: true,
    },
    balance: { display: "settings", refreshMinutes: 10 },
    goQuota: {
      enabled: false,
      display: "settings",
      refreshMinutes: 10,
      apiKey: "",
      main: "rolling",
      detail: true,
    },
    corner: {
      enabled: false,
      goRolling: false,
      goWeekly: false,
      goMonthly: false,
      budget: false,
    },
    historyDays: 182,
    fetchedAt: null,
    priceSource: "bundled",
  },
  meta: {
    now: Date.UTC(2026, 7, 17, 4),
    timezoneOffsetMinutes: -480,
    dayKey: "2026-08-17",
    monthKey: "2026-08",
  },
};

describe("CostMeterCard", () => {
  const initialRuntime = useRuntimeStore.getState();
  let view: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    useRuntimeStore.setState({ status: "ready" });
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    view?.unmount();
    view = undefined;
    vi.restoreAllMocks();
    useRuntimeStore.setState(initialRuntime, true);
  });

  it("renders the ledger summary and saves budget changes", async () => {
    const updateCostMeterConfig = vi.fn(async (patch: Record<string, unknown>) => ({
      ...baseState,
      config: { ...baseState.config, ...patch },
    }));
    vi.spyOn(runtime, "getClient").mockReturnValue({
      getCostMeterState: vi.fn().mockResolvedValue(baseState),
      updateCostMeterConfig,
    } as unknown as NonNullable<ReturnType<typeof runtime.getClient>>);

    await act(async () => {
      view = render(<CostMeterCard />);
    });

    expect((await screen.findAllByText("$1.25")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$4.50").length).toBeGreaterThan(0);
    expect(screen.queryByText("DeepSeek balance")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenCode Go quota")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Budget and accounts" }));
    await userEvent.click(screen.getByRole("switch", { name: "Enable spending budget" }));
    await waitFor(() => expect(updateCostMeterConfig).toHaveBeenCalledWith({
      budget: { ...baseState.config.budget, enabled: true },
    }));
    expect(await screen.findByText(/of \$10\.00/)).toBeInTheDocument();
  });

  it("refreshes the ledger when a runtime turn becomes idle", async () => {
    const getCostMeterState = vi.fn().mockResolvedValue(baseState);
    let notifyIdle: (() => void) | undefined;
    vi.spyOn(runtime, "getClient").mockReturnValue({
      getCostMeterState,
      onRuntimeEvent: vi.fn((listener) => {
        notifyIdle = () => listener({ type: "session.idle", sessionId: "session-1" });
        return () => undefined;
      }),
    } as unknown as NonNullable<ReturnType<typeof runtime.getClient>>);

    await act(async () => {
      view = render(<CostMeterCard />);
    });
    await screen.findByText("Cost trend");
    expect(getCostMeterState).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyIdle?.();
    });
    await waitFor(() => expect(getCostMeterState).toHaveBeenCalledTimes(2));
  });

  it("refreshes uncontrolled price and currency inputs from returned state", async () => {
    const syncedState: CostMeterState = {
      ...baseState,
      config: {
        ...baseState.config,
        prices: {
          ...baseState.config.prices,
          default: { cacheHit: 3.5, cacheMiss: 4.5, output: 5.5 },
        },
      },
    };
    const updateCostMeterConfig = vi.fn(async (patch: Record<string, unknown>) => ({
      ...baseState,
      config: { ...baseState.config, ...patch },
    }));
    vi.spyOn(runtime, "getClient").mockReturnValue({
      getCostMeterState: vi.fn().mockResolvedValue(baseState),
      updateCostMeterConfig,
      fetchCostMeterPrices: vi.fn().mockResolvedValue({ ok: true, message: "synced", state: syncedState }),
    } as unknown as NonNullable<ReturnType<typeof runtime.getClient>>);

    await act(async () => {
      view = render(<CostMeterCard />);
    });

    await userEvent.click(await screen.findByRole("tab", { name: "Pricing" }));
    const price = await screen.findByLabelText("default base cacheHit");
    expect(price).toHaveValue(0.14);
    await userEvent.click(screen.getByRole("button", { name: "Sync price catalog" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sync the price catalog?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Sync price catalog" }));
    await waitFor(() => expect(screen.getByLabelText("default base cacheHit")).toHaveValue(3.5));

    await userEvent.click(screen.getByRole("tab", { name: "Budget and accounts" }));
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "CNY");
    await waitFor(() => expect(updateCostMeterConfig).toHaveBeenCalledWith({
      currency: "CNY",
      symbol: "¥",
      decimals: 4,
      exchangeRate: 7.2,
    }));
    expect(screen.getByLabelText("Symbol")).toHaveValue("¥");
    expect(screen.getByLabelText("USD exchange rate")).toHaveValue(7.2);
    expect(screen.getByLabelText("Decimal places")).toHaveValue(4);
  });

  it("shows trends and separates subscription value from actual spend", async () => {
    const subscription = usage("2026-08-17", 1, 1);
    subscription.billedCost = 0;
    subscription.savings = 1;
    subscription.models = subscription.models.map((row) => ({
      ...row,
      id: "opencode-go/glm-5.3-flash",
      mode: "subscription",
      billedCost: 0,
      savings: 1,
    }));
    subscription.providers = subscription.providers.map((row) => ({
      ...row,
      id: "opencode-go",
      mode: "subscription",
      billedCost: 0,
      savings: 1,
    }));
    const subscriptionState: CostMeterState = {
      ...baseState,
      today: subscription,
      month: subscription,
      total: subscription,
      history: [subscription],
      budgetUsed: 0,
    };
    vi.spyOn(runtime, "getClient").mockReturnValue({
      getCostMeterState: vi.fn().mockResolvedValue(subscriptionState),
    } as unknown as NonNullable<ReturnType<typeof runtime.getClient>>);

    await act(async () => {
      view = render(<CostMeterCard />);
    });

    expect(await screen.findByText("Cost trend")).toBeInTheDocument();
    expect(screen.getByText("opencode-go/glm-5.3-flash")).toBeInTheDocument();
    expect(screen.getByText("Subscription")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("List value $1.00 · saved $1.00").length).toBe(2);
  });

  it("shows only used catalog prices and the separate cache-write rate", async () => {
    const catalogState: CostMeterState = {
      ...baseState,
      priceCatalog: {
        fetchedAt: "2026-08-17T03:00:00.000Z",
        modelCount: 6856,
        ignoredTiered: 0,
        used: [{
          id: "zhipuai/glm-5",
          source: "models.dev",
          price: { cacheHit: 0.2, cacheWrite: 0, cacheMiss: 1, output: 3.2 },
        }],
      },
    };
    vi.spyOn(runtime, "getClient").mockReturnValue({
      getCostMeterState: vi.fn().mockResolvedValue(catalogState),
    } as unknown as NonNullable<ReturnType<typeof runtime.getClient>>);

    await act(async () => {
      view = render(<CostMeterCard />);
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Pricing" }));

    expect(screen.getByText("Models.dev: 6856 models", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("zhipuai/glm-5")).toBeInTheDocument();
    expect(screen.getAllByText("models.dev")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Cache write" })).toHaveLength(3);
    expect(screen.queryByLabelText("zhipuai/glm-5 base cacheWrite")).not.toBeInTheDocument();
  });
});
