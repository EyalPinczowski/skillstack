/**
 * Build-time switch for the end-to-end build only (see vite.config.ts). The bundler replaces it
 * with a literal `true` or `false`, so in every normal build the code behind it is removed.
 */
declare const __E2E__: boolean;
