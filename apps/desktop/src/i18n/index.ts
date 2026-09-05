import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LOCALE, detectInitialLocale } from "./config";

// Statically bundled: the whole UI string set across 7 languages is a few KB,
// so it ships in the main chunk. Revisit lazy-loading only if this grows large.
import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enRuns from "./locales/en/runs.json";
import enSession from "./locales/en/session.json";
import enInspector from "./locales/en/inspector.json";
import enErrors from "./locales/en/errors.json";
import enPages from "./locales/en/pages.json";
import enGraph from "./locales/en/graph.json";

import zhCommon from "./locales/zh-Hans/common.json";
import zhNav from "./locales/zh-Hans/nav.json";
import zhSettings from "./locales/zh-Hans/settings.json";
import zhRuns from "./locales/zh-Hans/runs.json";
import zhSession from "./locales/zh-Hans/session.json";
import zhInspector from "./locales/zh-Hans/inspector.json";
import zhErrors from "./locales/zh-Hans/errors.json";
import zhPages from "./locales/zh-Hans/pages.json";
import zhGraph from "./locales/zh-Hans/graph.json";

import jaCommon from "./locales/ja/common.json";
import jaNav from "./locales/ja/nav.json";
import jaSettings from "./locales/ja/settings.json";
import jaRuns from "./locales/ja/runs.json";
import jaSession from "./locales/ja/session.json";
import jaInspector from "./locales/ja/inspector.json";
import jaErrors from "./locales/ja/errors.json";
import jaPages from "./locales/ja/pages.json";
import jaGraph from "./locales/ja/graph.json";

import esCommon from "./locales/es/common.json";
import esNav from "./locales/es/nav.json";
import esSettings from "./locales/es/settings.json";
import esRuns from "./locales/es/runs.json";
import esSession from "./locales/es/session.json";
import esInspector from "./locales/es/inspector.json";
import esErrors from "./locales/es/errors.json";
import esPages from "./locales/es/pages.json";
import esGraph from "./locales/es/graph.json";

import deCommon from "./locales/de/common.json";
import deNav from "./locales/de/nav.json";
import deSettings from "./locales/de/settings.json";
import deRuns from "./locales/de/runs.json";
import deSession from "./locales/de/session.json";
import deInspector from "./locales/de/inspector.json";
import deErrors from "./locales/de/errors.json";
import dePages from "./locales/de/pages.json";
import deGraph from "./locales/de/graph.json";

import frCommon from "./locales/fr/common.json";
import frNav from "./locales/fr/nav.json";
import frSettings from "./locales/fr/settings.json";
import frRuns from "./locales/fr/runs.json";
import frSession from "./locales/fr/session.json";
import frInspector from "./locales/fr/inspector.json";
import frErrors from "./locales/fr/errors.json";
import frPages from "./locales/fr/pages.json";
import frGraph from "./locales/fr/graph.json";

import koCommon from "./locales/ko/common.json";
import koNav from "./locales/ko/nav.json";
import koSettings from "./locales/ko/settings.json";
import koRuns from "./locales/ko/runs.json";
import koSession from "./locales/ko/session.json";
import koInspector from "./locales/ko/inspector.json";
import koErrors from "./locales/ko/errors.json";
import koPages from "./locales/ko/pages.json";
import koGraph from "./locales/ko/graph.json";

export const NAMESPACES = [
  "common", "nav", "settings", "runs", "session", "inspector", "errors", "pages", "graph",
] as const;

const resources = {
  en: { common: enCommon, nav: enNav, settings: enSettings, runs: enRuns, session: enSession, inspector: enInspector, errors: enErrors, pages: enPages, graph: enGraph },
  "zh-Hans": { common: zhCommon, nav: zhNav, settings: zhSettings, runs: zhRuns, session: zhSession, inspector: zhInspector, errors: zhErrors, pages: zhPages, graph: zhGraph },
  ja: { common: jaCommon, nav: jaNav, settings: jaSettings, runs: jaRuns, session: jaSession, inspector: jaInspector, errors: jaErrors, pages: jaPages, graph: jaGraph },
  es: { common: esCommon, nav: esNav, settings: esSettings, runs: esRuns, session: esSession, inspector: esInspector, errors: esErrors, pages: esPages, graph: esGraph },
  de: { common: deCommon, nav: deNav, settings: deSettings, runs: deRuns, session: deSession, inspector: deInspector, errors: deErrors, pages: dePages, graph: deGraph },
  fr: { common: frCommon, nav: frNav, settings: frSettings, runs: frRuns, session: frSession, inspector: frInspector, errors: frErrors, pages: frPages, graph: frGraph },
  ko: { common: koCommon, nav: koNav, settings: koSettings, runs: koRuns, session: koSession, inspector: koInspector, errors: koErrors, pages: koPages, graph: koGraph },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: NAMESPACES,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
});

export default i18n;
