module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:i18next/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["react-hooks", "react-refresh", "i18next"],
  ignorePatterns: ["dist", "src-tauri", ".eslintrc.cjs", "vite.config.ts"],
  rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
    // v6 options (verified against node_modules/eslint-plugin-i18next/lib/options/{schema.json,defaults.js}):
    // there is no `markupOnly`/`ignoreAttribute` in v6. `mode: "jsx-only"` validates every
    // literal inside a JSX subtree (text children AND attribute values), which is what we
    // need to also catch placeholder/title/aria-label/alt. The default mode, "jsx-text-only",
    // only checks bare JSX text children and skips all attribute literals outright.
    // `jsx-attributes.exclude` fully replaces (not merges with) the plugin default, so the
    // stock defaults (className, styleName, style, type, key, id, width, height) are repeated
    // here alongside the brief's technical/non-translatable attributes (role, to, href, src,
    // htmlFor, data-testid) plus attributes found during the fix-up pass to consistently hold
    // technical/internal discriminators rather than user-facing text across this codebase:
    // "value" (<option value="...">/controlled-input technical values, never the visible label),
    // "root" (FileRoot union: "workspace" | "base"), "variant" (component render-mode
    // discriminator), "language" (syntax-highlighting language id, not UI language), "dot"
    // (a Tailwind color-class prop, like className/style), "options" (Segmented control's list
    // of technical option keys — its paired `labelFor` prop does the actual translation), and
    // "fill" (SVG paint color, e.g. fill="currentColor" on a lucide-react icon component — native
    // <svg>/<path>/<circle> tags are already exempt for every attribute by the plugin itself, this
    // only covers the same paint-color usage on icon *components*).
    "i18next/no-literal-string": [
      "error",
      {
        mode: "jsx-only",
        "jsx-attributes": {
          exclude: [
            "className",
            "styleName",
            "style",
            "type",
            "key",
            "id",
            "width",
            "height",
            "role",
            "to",
            "href",
            "src",
            "htmlFor",
            "data-testid",
            "value",
            "root",
            "variant",
            "language",
            "dot",
            "options",
            "fill",
            "align",
          ],
        },
        "object-properties": {
          // `variant: "file"` etc. is the same inspector-payload discriminated-union tag as the
          // `variant` JSX attribute above, just nested one level down inside a `data={{ ... }}`
          // object literal instead of passed directly as a JSX attribute — same technical,
          // non-translatable value, so excluded the same way. Keeps the plugin's own default
          // (`[A-Z_-]+`, e.g. SCREAMING_CASE constants) alongside it.
          exclude: ["[A-Z_-]+", "variant"],
        },
        callees: {
          // `navigate` (react-router's useNavigate()) always takes a technical route path,
          // never user-facing text; verified against every call site in the codebase.
          exclude: [
            "i18n(ext)?",
            "t",
            "require",
            "addEventListener",
            "removeEventListener",
            "postMessage",
            "getElementById",
            "dispatch",
            "commit",
            "includes",
            "indexOf",
            "endsWith",
            "startsWith",
            "navigate",
          ],
        },
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"],
      rules: { "i18next/no-literal-string": "off" },
    },
    {
      files: ["src/i18n/**"],
      rules: { "i18next/no-literal-string": "off" },
    },
  ],
};
