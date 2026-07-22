// Tailwind 4 plugin replaces the v3 `tailwindcss` plugin and bundles
// autoprefixer internally. See https://tailwindcss.com/docs/upgrade-guide
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
