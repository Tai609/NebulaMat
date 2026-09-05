import { create } from "zustand";
import { detectInitialLocale, LOCALE_KEY } from "@/i18n/config";
import { isMacUA, isTauri, trafficLightsPresent } from "./tauri";

export type Theme = "light" | "warm" | "dark" | "aqua";
export type AquaScheme = "light" | "dark";

export const THEMES: readonly Theme[] = ["light", "warm", "dark", "aqua"];

const THEME_KEY = "ai4s.theme.v2";
/** Two-theme era key: its "light" was the warm paper palette, now called "warm". */
const LEGACY_THEME_KEY = "ai4s.theme";
const SIDEBAR_WIDTH_KEY = "ai4s.sidebar.width";
const SIDEBAR_COLLAPSED_KEY = "ai4s.sidebar.collapsed";
const INSPECTOR_WIDTH_KEY = "ai4s.inspector.width";
const ZOOM_KEY = "ai4s.zoom";
const COMPOSER_INPUTS_KEY = "ai4s.composer.inputs.v1";
const AQUA_BLUR_KEY = "ai4s.aqua.blur";
const AQUA_FROST_KEY = "ai4s.aqua.frost";
const AQUA_BRIGHTNESS_KEY = "ai4s.aqua.brightness";
const AQUA_SCHEME_KEY = "ai4s.aqua.scheme";
const AQUA_MODE_KEY = "ai4s.aqua.mode";
const AQUA_BACKGROUND_KEY = "ai4s.aqua.background";
const AQUA_WALLPAPER_KEY = "ai4s.aqua.wallpaper";
const AQUA_FLUID_HUE_KEY = "ai4s.aqua.fluidHue";
const AQUA_FLUID_DEPTH_KEY = "ai4s.aqua.fluidDepth";
const AQUA_LOGO_KEY = "ai4s.aqua.logo";
/** Legacy key retained so existing Aqua preferences survive the logo rename. */
const AQUA_WHALE_KEY = "ai4s.aqua.whale";
const AQUA_CRITTERS_KEY = "ai4s.aqua.critters";
const AQUA_MESH_KEY = "ai4s.aqua.mesh";
const AQUA_SPOTLIGHT_KEY = "ai4s.aqua.spotlight";
const AQUA_PRESS_KEY = "ai4s.aqua.press";
const AQUA_WALLPAPER_BLUR_KEY = "ai4s.aqua.wallpaperBlur";
const AQUA_WALLPAPER_FROST_KEY = "ai4s.aqua.wallpaperFrost";
const AQUA_VIDEO_BLUR_KEY = "ai4s.aqua.videoBlur";
const AQUA_VIDEO_BRIGHTNESS_KEY = "ai4s.aqua.videoBrightness";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

export const SIDEBAR_MIN = 184;
export const SIDEBAR_MAX = 340;
export const SIDEBAR_DEFAULT = 232;

export const INSPECTOR_MIN = 360;
export const INSPECTOR_MAX = 960;
export const INSPECTOR_DEFAULT = 560;

export function initialTheme(): Theme {
  // Aqua is the desktop presentation default. Persisted choices, including
  // the legacy two-theme values below, still take precedence.
  if (typeof window === "undefined") return "aqua";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "warm" || saved === "dark" || saved === "aqua") return saved;
  const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
  if (legacy === "dark") return "dark";
  if (legacy === "light") return "warm";
  return "aqua";
}

function initialSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(saved) || saved === 0) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved));
}

function initialInspectorWidth(): number {
  if (typeof window === "undefined") return INSPECTOR_DEFAULT;
  const saved = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
  if (!Number.isFinite(saved) || saved === 0) return INSPECTOR_DEFAULT;
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, saved));
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

function initialZoom(): number {
  if (typeof window === "undefined") return 1;
  const saved = Number(window.localStorage.getItem(ZOOM_KEY));
  if (!Number.isFinite(saved) || saved <= 0) return 1;
  return clampZoom(saved);
}

function initialAquaNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const saved = Number(raw);
  if (!Number.isFinite(saved)) return fallback;
  return Math.min(max, Math.max(min, saved));
}

function initialAquaScheme(): AquaScheme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(AQUA_SCHEME_KEY) === "light" ? "light" : "dark";
}

function initialAquaBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(key);
  return saved === null ? fallback : saved === "true";
}

function initialAquaMode(): "mica" | "compat" {
  if (typeof window === "undefined") return "mica";
  return window.localStorage.getItem(AQUA_MODE_KEY) === "compat" ? "compat" : "mica";
}

function initialAquaBackground(): "fluid" | "wallpaper" {
  if (typeof window === "undefined") return "fluid";
  return window.localStorage.getItem(AQUA_BACKGROUND_KEY) === "wallpaper" ? "wallpaper" : "fluid";
}

function initialAquaWallpaper(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AQUA_WALLPAPER_KEY) ?? "";
}

function initialComposerInputs(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(COMPOSER_INPUTS_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function persistComposerInputs(inputs: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMPOSER_INPUTS_KEY, JSON.stringify(inputs));
  } catch {
    /* storage full/unavailable never blocks typing */
  }
}

interface UiState {
  theme: Theme;
  /** Active UI locale (BCP-47). Persisted; mirrors the `theme` pattern. */
  locale: string;
  inspectorOpen: boolean;
  /** Right-pane width in px (persisted); the pane can also be maximized to
   *  cover the whole window (session-ephemeral, reset when the pane closes). */
  inspectorWidth: number;
  inspectorMaximized: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  /** macOS native fullscreen: the traffic lights slide away, so headers must
   *  drop their traffic-light inset. Synced from the Tauri window in AppShell. */
  isFullscreen: boolean;
  paletteOpen: boolean;
  /** Webview page-zoom factor (Cmd/Ctrl +/-). Persisted and owned in-app
   *  rather than by Tauri's zoomHotkeysEnabled, so the macOS titlebar strips
   *  can counter-scale for the fixed native traffic lights (see ZoomProvider). */
  zoom: number;
  /** Aqua glass controls, persisted independently from the selected theme. */
  aquaBlur: number;
  aquaFrost: number;
  aquaBrightness: number;
  /** Aqua's own resolved color scheme, independent from the stock theme. */
  aquaScheme: AquaScheme;
  aquaMode: "mica" | "compat";
  aquaBackground: "fluid" | "wallpaper";
  aquaWallpaper: string;
  aquaFluidHue: number;
  aquaFluidDepth: number;
  aquaLogo: boolean;
  aquaCritters: boolean;
  aquaMesh: boolean;
  aquaSpotlight: boolean;
  aquaPress: boolean;
  aquaWallpaperBlur: number;
  aquaWallpaperFrost: number;
  aquaVideoBlur: number;
  aquaVideoBrightness: number;
  /** One-shot text placed into the composer by another surface (e.g. the
   *  provenance Reproduce action) — consumed on the next composer render. */
  composerDraft: string | null;
  /** Unsent composer text keyed by pane, retained while the user changes views. */
  composerInputs: Record<string, string>;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLocale: (locale: string) => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorWidth: (width: number) => void;
  setInspectorMaximized: (maximized: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setIsFullscreen: (fullscreen: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (steps: number) => void;
  resetZoom: () => void;
  setAquaBlur: (blur: number) => void;
  setAquaFrost: (frost: number) => void;
  setAquaBrightness: (brightness: number) => void;
  setAquaScheme: (scheme: AquaScheme) => void;
  setAquaMode: (mode: "mica" | "compat") => void;
  setAquaBackground: (background: "fluid" | "wallpaper") => void;
  setAquaWallpaper: (wallpaper: string) => void;
  setAquaFluidHue: (hue: number) => void;
  setAquaFluidDepth: (depth: number) => void;
  setAquaLogo: (enabled: boolean) => void;
  setAquaCritters: (enabled: boolean) => void;
  setAquaMesh: (enabled: boolean) => void;
  setAquaSpotlight: (enabled: boolean) => void;
  setAquaPress: (enabled: boolean) => void;
  setAquaWallpaperBlur: (blur: number) => void;
  setAquaWallpaperFrost: (frost: number) => void;
  setAquaVideoBlur: (blur: number) => void;
  setAquaVideoBrightness: (brightness: number) => void;
  setComposerDraft: (draft: string | null) => void;
  setComposerInput: (key: string, value: string) => void;
  clearComposerInput: (key: string) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  locale: detectInitialLocale(),
  inspectorOpen: true,
  sidebarCollapsed:
    typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  sidebarWidth: initialSidebarWidth(),
  isFullscreen: false,
  paletteOpen: false,
  zoom: initialZoom(),
  aquaBlur: initialAquaNumber(AQUA_BLUR_KEY, 20, 0, 40),
  // Match the original DSH Aqua defaults. Brightness is a dark-scheme knob:
  // 0 is black and 50 is the unmodified backdrop.
  aquaFrost: initialAquaNumber(AQUA_FROST_KEY, 7, 0, 100),
  aquaBrightness: initialAquaNumber(AQUA_BRIGHTNESS_KEY, 50, 0, 100),
  aquaScheme: initialAquaScheme(),
  aquaMode: initialAquaMode(),
  aquaBackground: initialAquaBackground(),
  aquaWallpaper: initialAquaWallpaper(),
  aquaFluidHue: initialAquaNumber(AQUA_FLUID_HUE_KEY, 320, 0, 360),
  aquaFluidDepth: initialAquaNumber(AQUA_FLUID_DEPTH_KEY, 25, 0, 100),
  aquaLogo: initialAquaBool(
    AQUA_LOGO_KEY,
    initialAquaBool(AQUA_WHALE_KEY, true),
  ),
  aquaCritters: initialAquaBool(AQUA_CRITTERS_KEY, true),
  aquaMesh: initialAquaBool(AQUA_MESH_KEY, true),
  aquaSpotlight: initialAquaBool(AQUA_SPOTLIGHT_KEY, true),
  aquaPress: initialAquaBool(AQUA_PRESS_KEY, true),
  aquaWallpaperBlur: initialAquaNumber(AQUA_WALLPAPER_BLUR_KEY, 0, 0, 40),
  aquaWallpaperFrost: initialAquaNumber(AQUA_WALLPAPER_FROST_KEY, 0, 0, 100),
  aquaVideoBlur: initialAquaNumber(AQUA_VIDEO_BLUR_KEY, 6, 0, 40),
  aquaVideoBrightness: initialAquaNumber(AQUA_VIDEO_BRIGHTNESS_KEY, 45, 0, 100),
  setTheme: (theme) => {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(THEMES[(THEMES.indexOf(get().theme) + 1) % THEMES.length]),
  setLocale: (locale) => {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_KEY, locale);
    set({ locale });
  },
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  inspectorWidth: initialInspectorWidth(),
  inspectorMaximized: false,
  setInspectorWidth: (width) => {
    const inspectorWidth = Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(width)));
    if (typeof window !== "undefined")
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    set({ inspectorWidth });
  },
  setInspectorMaximized: (inspectorMaximized) => set({ inspectorMaximized }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    set({ sidebarCollapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setIsFullscreen: (isFullscreen) => set({ isFullscreen }),
  setSidebarWidth: (width) => {
    const sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
    if (typeof window !== "undefined")
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    set({ sidebarWidth });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setZoom: (z) => {
    const zoom = clampZoom(z);
    if (typeof window !== "undefined") window.localStorage.setItem(ZOOM_KEY, String(zoom));
    set({ zoom });
  },
  zoomBy: (steps) => get().setZoom(get().zoom + steps * ZOOM_STEP),
  resetZoom: () => get().setZoom(1),
  setAquaBlur: (value) => {
    const aquaBlur = Math.min(40, Math.max(0, Math.round(value * 2) / 2));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_BLUR_KEY, String(aquaBlur));
    set({ aquaBlur });
  },
  setAquaFrost: (value) => {
    const aquaFrost = Math.min(100, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_FROST_KEY, String(aquaFrost));
    set({ aquaFrost });
  },
  setAquaBrightness: (value) => {
    const aquaBrightness = Math.min(100, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_BRIGHTNESS_KEY, String(aquaBrightness));
    set({ aquaBrightness });
  },
  setAquaScheme: (aquaScheme) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_SCHEME_KEY, aquaScheme);
    set({ aquaScheme });
  },
  setAquaMode: (aquaMode) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_MODE_KEY, aquaMode);
    set({ aquaMode });
  },
  setAquaBackground: (aquaBackground) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_BACKGROUND_KEY, aquaBackground);
    set({ aquaBackground });
  },
  setAquaWallpaper: (aquaWallpaper) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_WALLPAPER_KEY, aquaWallpaper);
    set({ aquaWallpaper });
  },
  setAquaFluidHue: (value) => {
    const aquaFluidHue = Math.min(360, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_FLUID_HUE_KEY, String(aquaFluidHue));
    set({ aquaFluidHue });
  },
  setAquaFluidDepth: (value) => {
    const aquaFluidDepth = Math.min(100, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_FLUID_DEPTH_KEY, String(aquaFluidDepth));
    set({ aquaFluidDepth });
  },
  setAquaLogo: (aquaLogo) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_LOGO_KEY, String(aquaLogo));
    set({ aquaLogo });
  },
  setAquaCritters: (aquaCritters) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_CRITTERS_KEY, String(aquaCritters));
    set({ aquaCritters });
  },
  setAquaMesh: (aquaMesh) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_MESH_KEY, String(aquaMesh));
    set({ aquaMesh });
  },
  setAquaSpotlight: (aquaSpotlight) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_SPOTLIGHT_KEY, String(aquaSpotlight));
    set({ aquaSpotlight });
  },
  setAquaPress: (aquaPress) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_PRESS_KEY, String(aquaPress));
    set({ aquaPress });
  },
  setAquaWallpaperBlur: (value) => {
    const aquaWallpaperBlur = Math.min(40, Math.max(0, Math.round(value * 2) / 2));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_WALLPAPER_BLUR_KEY, String(aquaWallpaperBlur));
    set({ aquaWallpaperBlur });
  },
  setAquaWallpaperFrost: (value) => {
    const aquaWallpaperFrost = Math.min(100, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_WALLPAPER_FROST_KEY, String(aquaWallpaperFrost));
    set({ aquaWallpaperFrost });
  },
  setAquaVideoBlur: (value) => {
    const aquaVideoBlur = Math.min(40, Math.max(0, Math.round(value * 2) / 2));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_VIDEO_BLUR_KEY, String(aquaVideoBlur));
    set({ aquaVideoBlur });
  },
  setAquaVideoBrightness: (value) => {
    const aquaVideoBrightness = Math.min(100, Math.max(0, Math.round(value)));
    if (typeof window !== "undefined") window.localStorage.setItem(AQUA_VIDEO_BRIGHTNESS_KEY, String(aquaVideoBrightness));
    set({ aquaVideoBrightness });
  },
  composerDraft: null,
  setComposerDraft: (composerDraft) => set({ composerDraft }),
  composerInputs: initialComposerInputs(),
  setComposerInput: (key, value) => {
    if (!key) return;
    set((state) => {
      const composerInputs = { ...state.composerInputs };
      if (value) composerInputs[key] = value;
      else delete composerInputs[key];
      persistComposerInputs(composerInputs);
      return { composerInputs };
    });
  },
  clearComposerInput: (key) => {
    if (!key) return;
    set((state) => {
      if (!(key in state.composerInputs)) return state;
      const composerInputs = { ...state.composerInputs };
      delete composerInputs[key];
      persistComposerInputs(composerInputs);
      return { composerInputs };
    });
  },
}));

/** Whether headers should inset for the macOS overlay-titlebar traffic lights.
 *  False in a browser, on non-mac, and in fullscreen (the lights hide). The one
 *  source of truth for every titlebar/header that clears the lights. */
export function useOverlayTitlebar(): boolean {
  const isFullscreen = useUiStore((s) => s.isFullscreen);
  return trafficLightsPresent(isTauri, isMacUA(), isFullscreen);
}
