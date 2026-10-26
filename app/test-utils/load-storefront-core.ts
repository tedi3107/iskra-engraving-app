import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The storefront core is a plain browser script (UMD), not an ES module, and
// the repo is "type": "module" — so it's evaluated with a CommonJS-style
// module object instead of being imported.
export function loadStorefrontCore() {
  const path = fileURLToPath(
    new URL("../../extensions/engraving-preview/assets/engraving-preview-core.js", import.meta.url),
  );
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function("module", "exports", readFileSync(path, "utf8"))(mod, mod.exports);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mod.exports as any;
}
