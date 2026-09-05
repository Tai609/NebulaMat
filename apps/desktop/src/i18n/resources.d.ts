import "i18next";

import type enCommon from "./locales/en/common.json";
import type enNav from "./locales/en/nav.json";
import type enSettings from "./locales/en/settings.json";
import type enRuns from "./locales/en/runs.json";
import type enSession from "./locales/en/session.json";
import type enInspector from "./locales/en/inspector.json";
import type enErrors from "./locales/en/errors.json";
import type enPages from "./locales/en/pages.json";
import type enGraph from "./locales/en/graph.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof enCommon;
      nav: typeof enNav;
      settings: typeof enSettings;
      runs: typeof enRuns;
      session: typeof enSession;
      inspector: typeof enInspector;
      errors: typeof enErrors;
      pages: typeof enPages;
      graph: typeof enGraph;
    };
  }
}
