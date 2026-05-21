import type { Config } from "tailwindcss";

// NOTE: Tailwind v4 reads its theme/tokens from CSS via `@theme` in
// `src/index.css` (see the shadcn init output). This file exists so the
// project still has a discoverable `tailwind.config.ts` for tooling that
// looks for one, and so that we have a place to extend `content` globs or
// register plugins from TS if/when we ever need them.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
};

export default config;
