import { API_VERSION, fromEnv, layer, make, PolygresClient, VERSION } from "./client.js"

export * from "./client.js"
export * from "./errors.js"
export * from "./pagination.js"
export * from "./schemas.js"

export const Polygres = {
  API_VERSION,
  Client: PolygresClient,
  VERSION,
  fromEnv,
  layer,
  make,
} as const
