import { useEffect, useRef } from "react";
import { useUiStore, type Theme } from "@/lib/store";
import { attachFluidInteractions } from "./fluid-interactions";
import { attachFluidShader, SITE_FLUID_PARAMS, type FluidShaderHandle } from "./fluid-shader";
import { fluidToneColors, HUE_BASE } from "./fluid-tones";
import { ensureAmbientScene, ensurePageFades, removeAmbientScene, removePageFades } from "./critters";
import { mountMesh, type MeshHandle } from "./mesh";
import { mountLogo, type LogoHandle } from "./whale";
import { startSpotlight, SPOTLIGHT_ATTRIBUTE, PRESS_ATTRIBUTE } from "./spotlight";
import { loadVideoBlob } from "./wallpaper-store";
import { startSeamStamper } from "./seam-stamper";

type AquaSnapshot = {
  theme: Theme;
  scheme: "light" | "dark";
  mode: "mica" | "compat";
  background: "fluid" | "wallpaper";
  wallpaper: string;
  blur: number;
  frost: number;
  fluidHue: number;
  fluidDepth: number;
  brightness: number;
  logo: boolean;
  critters: boolean;
  mesh: boolean;
  spotlight: boolean;
  press: boolean;
  wallpaperBlur: number;
  wallpaperFrost: number;
  videoBlur: number;
  videoBrightness: number;
};

type AquaController = {
  update: (next: AquaSnapshot) => void;
  dispose: () => void;
};

function isVideoWallpaper(value: string): boolean {
  return value.startsWith("data:video/") || value.startsWith("idb:") || value.startsWith("fsa:");
}

function createController(initial: AquaSnapshot): AquaController {
  const root = document.documentElement;
  root.setAttribute("data-dsh-aqua", "");
  ensureAmbientScene();
  ensurePageFades();
  const ambient = document.querySelector<HTMLElement>("[data-dsh-aqua-ambient]");
  const wallpaperLayer = document.querySelector<HTMLElement>("[data-dsh-aqua-wallpaper-layer]");
  const fluidCanvas = document.querySelector<HTMLCanvasElement>("[data-dsh-aqua-fluid-canvas]");
  const image = document.querySelector<HTMLImageElement>("[data-dsh-aqua-wallpaper-img]");
  const video = document.querySelector<HTMLVideoElement>("[data-dsh-aqua-wallpaper-video]");
  const fluid: FluidShaderHandle | undefined = fluidCanvas
    ? attachFluidShader(fluidCanvas, { ...SITE_FLUID_PARAMS, ...fluidToneColors(initial.scheme === "dark", initial.fluidHue, initial.fluidDepth) })
    : undefined;
  const interactionDisposer = fluid && fluidCanvas ? attachFluidInteractions({ main: fluid, mainCanvas: fluidCanvas }) : undefined;
  let mesh: MeshHandle | undefined;
  let logo: LogoHandle | undefined;
  let current = initial;
  let videoObjectUrl: string | undefined;
  let videoMarker: string | undefined;
  const seamsDisposer = startSeamStamper();
  const spotlightDisposer = startSpotlight();

  const setMedia = (wallpaper: string) => {
    const mediaVideo = isVideoWallpaper(wallpaper);
    if (image) {
      if (current.background === "wallpaper" && wallpaper !== "" && !mediaVideo) image.src = wallpaper;
      else image.removeAttribute("src");
    }
    if (!video) return;
    if (current.background !== "wallpaper" || !mediaVideo) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = undefined;
      videoMarker = undefined;
      return;
    }
    const applyVideo = (src: string, marker: string) => {
      if (videoMarker === marker && video.getAttribute("src") === src) return;
      videoMarker = marker;
      video.src = src;
      video.loop = true;
      video.muted = true;
      void video.play().catch(() => undefined);
    };
    if (wallpaper.startsWith("idb:")) {
      const id = wallpaper.slice(4);
      void loadVideoBlob(id).then((blob) => {
        if (!blob || current.wallpaper !== wallpaper) return;
        if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
        videoObjectUrl = URL.createObjectURL(blob);
        applyVideo(videoObjectUrl, wallpaper);
      });
    } else if (wallpaper.startsWith("fsa:")) {
      // File-system handles are intentionally handled by the settings picker.
      // A later re-pick writes an idb marker, keeping the renderer simple.
      video.removeAttribute("src");
    } else {
      applyVideo(wallpaper, wallpaper);
    }
  };

  const syncDecoration = () => {
    if (current.logo && !logo && ambient) logo = mountLogo(ambient, current.scheme === "dark");
    if (current.logo && logo) logo.setDark(current.scheme === "dark");
    if (!current.logo && logo) {
      logo.dispose();
      logo = undefined;
    }
    if (current.mesh && !mesh && ambient) mesh = mountMesh(ambient);
    if (!current.mesh && mesh) {
      mesh.dispose();
      mesh = undefined;
    }
  };

  const apply = () => {
    const dark = current.scheme === "dark";
    root.dataset.aquaScheme = current.scheme;
    root.toggleAttribute("data-dsh-float", current.mode === "mica");
    root.toggleAttribute("data-dsh-compat", current.mode === "compat");
    root.toggleAttribute(SPOTLIGHT_ATTRIBUTE, current.mode === "mica" && current.spotlight);
    root.toggleAttribute(PRESS_ATTRIBUTE, current.mode === "mica" && current.press);
    root.style.setProperty("--dsh-aqua-blur", `${current.blur}px`);
    root.style.setProperty("--dsh-aqua-frost", String(Math.min(current.frost / 50, 1.4)));
    root.style.setProperty("--dsh-aqua-surface-frost", String(Math.min((current.frost + 20) / 50, 1.4)));
    root.style.setProperty("--dsh-aqua-wallpaper-blur", `${current.wallpaperBlur}px`);
    root.style.setProperty("--dsh-aqua-wallpaper-frost", String(current.wallpaperFrost / 100));
    root.style.setProperty("--dsh-aqua-video-blur", `${current.videoBlur}px`);
    root.style.setProperty("--dsh-aqua-video-dim", String(((100 - current.videoBrightness) / 100) * 0.65));
    root.style.setProperty("--dsh-aqua-brightness-black", String(dark ? Math.max(0, (50 - current.brightness) / 50) : 0));
    root.style.setProperty("--dsh-aqua-brightness-white", String(dark ? 0 : Math.max(0, (current.brightness - 50) / 50)));
    const glowHue = ((current.fluidHue + HUE_BASE) % 360 + 360) % 360;
    root.style.setProperty("--dsh-aqua-spot-color", `hsla(${glowHue}, 90%, 62%, 0.17)`);
    ambient?.setAttribute("data-background", current.background);
    ambient?.setAttribute("data-critters", current.critters ? "on" : "off");
    wallpaperLayer?.setAttribute("data-background", current.background);
    wallpaperLayer?.setAttribute("data-media", isVideoWallpaper(current.wallpaper) ? "video" : "image");
    const wallpaperOn = current.background === "wallpaper" && current.wallpaper !== "";
    root.toggleAttribute("data-dsh-aqua-wallpaper", wallpaperOn);
    if (wallpaperOn) root.setAttribute("data-dsh-aqua-media", isVideoWallpaper(current.wallpaper) ? "video" : "image");
    else root.removeAttribute("data-dsh-aqua-media");
    fluid?.setParams({ ...SITE_FLUID_PARAMS, ...fluidToneColors(dark, current.fluidHue, current.fluidDepth) });
    setMedia(current.wallpaper);
    syncDecoration();
  };

  apply();
  return {
    update: (next) => {
      current = next;
      apply();
    },
    dispose: () => {
      interactionDisposer?.();
      fluid?.dispose();
      mesh?.dispose();
      logo?.dispose();
      spotlightDisposer();
      seamsDisposer();
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
      root.removeAttribute("data-dsh-aqua");
      root.removeAttribute("data-dsh-float");
      root.removeAttribute("data-dsh-compat");
      root.removeAttribute("data-dsh-aqua-wallpaper");
      root.removeAttribute("data-dsh-aqua-media");
      root.removeAttribute(SPOTLIGHT_ATTRIBUTE);
      root.removeAttribute(PRESS_ATTRIBUTE);
      removeAmbientScene();
      removePageFades();
    },
  };
}

function snapshot(): AquaSnapshot {
  const state = useUiStore.getState();
  return {
    theme: state.theme,
    scheme: state.aquaScheme,
    mode: state.aquaMode,
    background: state.aquaBackground,
    wallpaper: state.aquaWallpaper,
    blur: state.aquaBlur,
    frost: state.aquaFrost,
    fluidHue: state.aquaFluidHue,
    fluidDepth: state.aquaFluidDepth,
    brightness: state.aquaBrightness,
    logo: state.aquaLogo,
    critters: state.aquaCritters,
    mesh: state.aquaMesh,
    spotlight: state.aquaSpotlight,
    press: state.aquaPress,
    wallpaperBlur: state.aquaWallpaperBlur,
    wallpaperFrost: state.aquaWallpaperFrost,
    videoBlur: state.aquaVideoBlur,
    videoBrightness: state.aquaVideoBrightness,
  };
}

export function AquaEffects() {
  const theme = useUiStore((state) => state.theme);
  const controller = useRef<AquaController | null>(null);
  const settingsKey = useUiStore((state) => [
    state.aquaScheme, state.aquaMode, state.aquaBackground, state.aquaWallpaper, state.aquaBlur, state.aquaFrost,
    state.aquaFluidHue, state.aquaFluidDepth, state.aquaBrightness, state.aquaLogo,
    state.aquaCritters, state.aquaMesh, state.aquaSpotlight, state.aquaPress, state.aquaWallpaperBlur,
    state.aquaWallpaperFrost, state.aquaVideoBlur, state.aquaVideoBrightness,
  ].join("|"));

  useEffect(() => {
    if (theme !== "aqua") {
      controller.current?.dispose();
      controller.current = null;
      return;
    }
    controller.current = createController(snapshot());
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (theme === "aqua") controller.current?.update(snapshot());
  // The tuple is a stable dependency boundary for the visual settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, settingsKey]);
  return null;
}
