import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_qhmizglegautrvhyrqov",
  dirs: ["./trigger"],
  build: {
    // Push the Medplum creds + the Anthropic key (for the AI verify step) to the
    // Trigger environment at deploy time so the deployed task can reach the FHIR
    // store and the model. BASEPAIR_MODEL is optional (defaults in verify.ts).
    // UPSTASH_* are optional too — the terminology cache (normalizeDrug, #26)
    // falls back to an in-process map when they're unset.
    extensions: [
      syncEnvVars(async () =>
        [
          "MEDPLUM_BASE_URL",
          "MEDPLUM_CLIENT_ID",
          "MEDPLUM_CLIENT_SECRET",
          "ANTHROPIC_API_KEY",
          "BASEPAIR_MODEL",
          "UPSTASH_REDIS_REST_URL",
          "UPSTASH_REDIS_REST_TOKEN",
        ]
          .filter((name) => process.env[name])
          .map((name) => ({ name, value: process.env[name]! })),
      ),
    ],
  },
  // Tasks run in Trigger.dev's managed Node env (isolates the heavy AI/FHIR
  // work from Bun-compat risk, see docs/ARCHITECTURE.md).
  runtime: "node-22",
  logLevel: "info",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  maxDuration: 300,
});
