import type { Migration } from "./types.js";

/**
 * Production template migrations.
 * Empty at TEMPLATE_VERSION 0.2.0 — content refresh is re-render via planners;
 * structural changes require a registered migration here (see ADR 005).
 */
export const PRODUCTION_MIGRATIONS: Migration[] = [];
