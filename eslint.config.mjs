import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // public/lumora holds a prebuilt Vite bundle (easter-egg page), not source.
  globalIgnores([".next/**", ".next-*/**", ".data/**", "next-env.d.ts", "prototype/**", "public/lumora/**"]),
]);
