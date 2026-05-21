// PostCSS config is kept for ecosystem compatibility, but Tailwind itself
// runs via the `@tailwindcss/vite` plugin in `vite.config.ts`, not via
// PostCSS. autoprefixer remains useful for any non-Tailwind CSS we add.
export default {
  plugins: {
    autoprefixer: {},
  },
};
