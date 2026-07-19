import { fileURLToPath } from "node:url";

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  bettingCountdownMs: number;
  startingBalance: number;
  simulatedRollDelayMs: number;
  rebuyChips: number;
  rollTimeoutMs: number;
  authMode: "local" | "entra";
  entraAuthority: string | null;
  entraAudience: string | null;
  entraIssuer: string | null;
}

export function readConfig(env = process.env): AppConfig {
  const entraAuthority = optionalString(env.ENTRA_AUTHORITY);
  const entraAudience = optionalString(env.ENTRA_AUDIENCE);
  const configuredAuthMode = optionalString(env.AUTH_MODE);
  const authMode =
    configuredAuthMode === "entra" || (!configuredAuthMode && entraAuthority && entraAudience)
      ? "entra"
      : "local";

  return {
    port: numberFromEnv(env.PORT, 8080),
    host: env.HOST ?? "0.0.0.0",
    databasePath: env.DATABASE_PATH ?? defaultDatabasePath(),
    bettingCountdownMs: numberFromEnv(env.BETTING_COUNTDOWN_SECONDS, 10) * 1000,
    startingBalance: numberFromEnv(env.STARTING_BALANCE, 1000),
    simulatedRollDelayMs: numberFromEnv(env.SIMULATED_ROLL_DELAY_MS, 900),
    rebuyChips: numberFromEnv(env.REBUY_CHIPS, 2000),
    rollTimeoutMs: numberFromEnv(env.ROLL_TIMEOUT_SECONDS, 30) * 1000,
    authMode,
    entraAuthority,
    entraAudience,
    entraIssuer: optionalString(env.ENTRA_ISSUER)
  };
}

function defaultDatabasePath(): string {
  return fileURLToPath(new URL("../../../data/bubble-craps.sqlite", import.meta.url));
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalString(value: string | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}
