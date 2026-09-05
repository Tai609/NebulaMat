import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import { LocaleProvider } from "./app/providers/LocaleProvider";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import { ZoomProvider } from "./app/providers/ZoomProvider";
import { router } from "./app/router";
import { consumeUrlToken, installGatewayAuthGuard } from "./lib/webMode";
import "./index.css";
import "./lib/aqua/fonts.css";
import "./lib/aqua/aqua.css";

// Web client: adopt a token from the opened link (so a copied URL just works),
// then catch gateway 401s (rotated/revoked token) → re-auth. Both before any
// DeepSeekHarnessClient binds fetch or the app reads the stored token.
consumeUrlToken();
installGatewayAuthGuard();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <ZoomProvider>
          <RouterProvider router={router} />
        </ZoomProvider>
      </ThemeProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
