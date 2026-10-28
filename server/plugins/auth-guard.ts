import { definePlugin } from "nitro";
import { assertProductionAuth } from "../../src/lib/auth/runtime.ts";

/**
 * Runs when the production server boots. Outside the Grok sandbox, missing
 * auth settings throw here, so a misconfigured deploy does not start.
 * The dev server does not load Nitro plugins.
 */
export default definePlugin(() => {
  assertProductionAuth();
});
