import { create } from "zustand";
/** Deliberately unset by default. A future release endpoint can be supplied
 * through VITE_UPDATE_SOURCE_URL without restoring a bundled GitHub target. */
const UPDATE_SOURCE_URL: string | null = import.meta.env.VITE_UPDATE_SOURCE_URL?.trim() || null;
export const UPDATE_SOURCE_CONFIGURED = Boolean(UPDATE_SOURCE_URL);
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ENABLED_KEY = "openscience.update.enabled";
const BADGE_KEY = "openscience.update.badge";
const DISMISSED_KEY = "openscience.update.dismissed";
const LAST_CHECKED_KEY = "openscience.update.lastCheckedAt";
const LATEST_KEY = "openscience.update.latest";

export interface UpdateInfo {
  version: string;
  url: string;
  name: string | null;
  publishedAt: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  name?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

type CheckStatus = "idle" | "checking" | "ready" | "error";

interface UpdateState {
  sourceConfigured: boolean;
  enabled: boolean;
  badgeEnabled: boolean;
  dismissedVersion: string | null;
  lastCheckedAt: number | null;
  latest: UpdateInfo | null;
  status: CheckStatus;
  error: string | null;
  currentVersion: string;
  hasUpdate: boolean;
  showBadge: boolean;
  setEnabled: (enabled: boolean) => void;
  setBadgeEnabled: (enabled: boolean) => void;
  dismissBadge: () => void;
  check: (opts?: { manual?: boolean; now?: number }) => Promise<void>;
  maybeAutoCheck: () => Promise<void>;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return fallback;
}

function readNumber(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readLatest(): UpdateInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LATEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UpdateInfo;
    return parsed?.version && parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

function persistLatest(latest: UpdateInfo | null): void {
  if (typeof window === "undefined") return;
  if (latest) window.localStorage.setItem(LATEST_KEY, JSON.stringify(latest));
  else window.localStorage.removeItem(LATEST_KEY);
}

function setLocal(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0] ?? "";
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(".").map((x) => Number.parseInt(x, 10));
  const pb = normalizeVersion(b).split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function shouldAutoCheck(lastCheckedAt: number | null, now: number): boolean {
  return !lastCheckedAt || now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

export function shouldShowUpdateBadge(args: {
  enabled: boolean;
  badgeEnabled: boolean;
  latest: UpdateInfo | null;
  currentVersion: string;
  dismissedVersion: string | null;
}): boolean {
  if (!args.enabled || !args.badgeEnabled || !args.latest) return false;
  if (!isNewerVersion(args.latest.version, args.currentVersion)) return false;
  return normalizeVersion(args.latest.version) !== normalizeVersion(args.dismissedVersion ?? "");
}

function derive(base: Pick<UpdateState, "enabled" | "badgeEnabled" | "latest" | "currentVersion" | "dismissedVersion">) {
  const hasUpdate = Boolean(base.latest && isNewerVersion(base.latest.version, base.currentVersion));
  const showBadge = shouldShowUpdateBadge(base);
  return { hasUpdate, showBadge };
}

async function fetchLatestRelease(): Promise<UpdateInfo> {
  if (!UPDATE_SOURCE_URL) throw new Error("Update source is not configured");

  const res = await fetch(UPDATE_SOURCE_URL, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const json = (await res.json()) as GitHubRelease;
  const version = json.tag_name?.trim();
  const url = json.html_url?.trim();
  if (!version || !url) throw new Error("GitHub release response was incomplete");
  return {
    version,
    url,
    name: json.name ?? null,
    publishedAt: json.published_at ?? null,
  };
}

const initial = {
  sourceConfigured: UPDATE_SOURCE_CONFIGURED,
  enabled: UPDATE_SOURCE_CONFIGURED && readBool(ENABLED_KEY, true),
  badgeEnabled: readBool(BADGE_KEY, true),
  dismissedVersion: typeof window === "undefined" ? null : window.localStorage.getItem(DISMISSED_KEY),
  lastCheckedAt: readNumber(LAST_CHECKED_KEY),
  latest: UPDATE_SOURCE_CONFIGURED ? readLatest() : null,
  currentVersion: __APP_VERSION__,
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  ...initial,
  status: "idle",
  error: null,
  ...derive(initial),
  setEnabled: (enabled) => {
    enabled = UPDATE_SOURCE_CONFIGURED && enabled;
    setLocal(ENABLED_KEY, enabled ? "1" : "0");
    set((s) => ({ enabled, ...derive({ ...s, enabled }) }));
  },
  setBadgeEnabled: (badgeEnabled) => {
    badgeEnabled = UPDATE_SOURCE_CONFIGURED && badgeEnabled;
    setLocal(BADGE_KEY, badgeEnabled ? "1" : "0");
    set((s) => ({ badgeEnabled, ...derive({ ...s, badgeEnabled }) }));
  },
  dismissBadge: () => {
    const dismissedVersion = get().latest?.version ?? null;
    setLocal(DISMISSED_KEY, dismissedVersion);
    set((s) => ({ dismissedVersion, ...derive({ ...s, dismissedVersion }) }));
  },
  check: async (opts) => {
    if (!UPDATE_SOURCE_CONFIGURED) return;
    const manual = opts?.manual ?? false;
    const now = opts?.now ?? Date.now();
    const s = get();
    if (!manual) {
      if (!s.enabled) return;
      if (!shouldAutoCheck(s.lastCheckedAt, now)) return;
    }
    set({ status: "checking", error: null });
    try {
      const latest = await fetchLatestRelease();
      setLocal(LAST_CHECKED_KEY, String(now));
      persistLatest(latest);
      set((cur) => ({
        latest,
        lastCheckedAt: now,
        status: "ready",
        error: null,
        ...derive({ ...cur, latest }),
      }));
    } catch (e) {
      setLocal(LAST_CHECKED_KEY, String(now));
      set({
        lastCheckedAt: now,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  maybeAutoCheck: () => get().check({ manual: false }),
}));
