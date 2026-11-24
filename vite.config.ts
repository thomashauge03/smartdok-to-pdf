// Vanlig Vite-oppsett. Det erstatter @lovable.dev/vite-tanstack-config, som la
// inn de samme pluginene pluss Lovables egne (komponentmerking, bro til
// Lovable-editoren, assets-proxy). Appen bygges og driftes på Vercel, ikke Lovable.
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Bygget stopper hvis serverkode (server-only, src/**/server/**) havner i nettleserpakken.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // src/server.ts pakker inn SSR-feil.
      server: { entry: "server" },
    }),
    // Bare ved bygg: nitro kjenner igjen Vercel (VERCEL=1). hentTimer venter opptil
    // 110 s på adminbordet, og Vercels standardgrense er 10-15 s.
    ...(command === "build" ? [nitro({ vercel: { functions: { maxDuration: 120 } } })] : []),
    viteReact(),
  ],
  // Samme CSS-behandling i dev som i bygg, så forhåndsvisningen ikke ser annerledes ut enn det som går ut.
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  // Bare React-kjernen: tas @tanstack/react-start med her, havner serverdelen i nettleserpakken.
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  server: { host: "::", port: 8080 },
}));
