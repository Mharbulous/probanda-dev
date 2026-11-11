// The fixed port each bundle's page listener uses, from the per-device probanda.json
// (config-path.ts). `page_ports` maps a bundle to its port; the lawyer bundle also honours the
// older `page_api_port`. Each bundle needs its own port because no bundle may carry another's
// route handlers (test/bundle-modules.unit.test.mjs). TimeCamp and mail pages use ephemeral ports.

import { existsSync, readFileSync } from "node:fs";

import { configPath } from "../config-path.js";

export type PageBundle = "lawyer" | "file-manager" | "timekeeping";

export const DEFAULT_PAGE_PORTS: Record<PageBundle, number> = { lawyer: 47615, "file-manager": 47616, timekeeping: 47617 };

/** A probanda.json port setting that is not a port. `code` names the setting. */
export class PagePortError extends Error {
  constructor(message: string, readonly code: "invalid_page_ports" | "invalid_page_api_port") {
    super(message);
  }
}

const isPort = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;

/** The bundle's port: `page_ports[bundle]`, else (lawyer only) `page_api_port`, else the default. */
export function pagePort(bundle: PageBundle, env: NodeJS.ProcessEnv): number {
  const path = configPath(env);
  if (!existsSync(path)) return DEFAULT_PAGE_PORTS[bundle];
  const config = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown> | null;
  const ports = config?.page_ports;
  if (ports !== undefined && ports !== null) {
    if (typeof ports !== "object" || Array.isArray(ports)) {
      throw new PagePortError(`${path}: page_ports must be an object mapping a plugin to its port, got ${JSON.stringify(ports)}`, "invalid_page_ports");
    }
    const value = (ports as Record<string, unknown>)[bundle];
    if (value !== undefined && value !== null) {
      if (!isPort(value)) throw new PagePortError(`${path}: page_ports.${bundle} must be a whole number from 1 to 65535, got ${JSON.stringify(value)}`, "invalid_page_ports");
      return value as number;
    }
  }
  if (bundle === "lawyer") {
    const value = config?.page_api_port;
    if (value !== undefined && value !== null) {
      if (!isPort(value)) throw new PagePortError(`${path}: page_api_port must be a whole number from 1 to 65535, got ${JSON.stringify(value)}`, "invalid_page_api_port");
      return value as number;
    }
  }
  return DEFAULT_PAGE_PORTS[bundle];
}
