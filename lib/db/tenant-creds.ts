/**
 * Sealing/opening of a tenant's Medplum ClientApplication credentials for
 * storage in `tenants.medplum_client_creds` (jsonb).
 *
 * The column never holds plaintext: creds are encrypted app-side with
 * AES-256-GCM under a single key held ONLY in the app / Trigger.dev
 * environment (`TENANT_CREDS_KEY`), never in the database. So a DB dump, a
 * leaked Supabase key, or an RLS mistake exposes ciphertext an attacker cannot
 * open without also compromising the app environment. See
 * docs/ARCHITECTURE.md §5b "Secret handling".
 *
 * Envelope shape (versioned so the algorithm can rotate):
 *   { v: 1, alg: "aes-256-gcm", iv, ct, tag }   — all base64.
 *
 * Key: 32 bytes, base64-encoded. Generate with `openssl rand -base64 32`.
 * Rotation: set the new key, re-run `bun scripts/seed-tenant.ts` per tenant
 * (re-seals from the source creds), then retire the old key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

/** Plaintext Medplum ClientApplication credentials (never persisted). */
export type MedplumCreds = {
  clientId: string;
  clientSecret: string;
};

const medplumCredsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const sealedSecretSchema = z.object({
  v: z.literal(1),
  alg: z.literal("aes-256-gcm"),
  /** 12-byte GCM nonce, base64. */
  iv: z.string().min(1),
  /** Ciphertext, base64. */
  ct: z.string().min(1),
  /** 16-byte GCM auth tag, base64. */
  tag: z.string().min(1),
});

/** The encrypted envelope actually stored in the jsonb column. */
export type SealedSecret = z.infer<typeof sealedSecretSchema>;

function encryptionKey(): Buffer {
  const raw = process.env.TENANT_CREDS_KEY;
  if (!raw) {
    throw new Error(
      "TENANT_CREDS_KEY is not set (32-byte base64 key for tenant Medplum creds; generate with `openssl rand -base64 32`).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TENANT_CREDS_KEY must be exactly 32 bytes, base64-encoded.");
  }
  return key;
}

/** Encrypt creds for storage. Fresh random nonce per call. */
export function sealMedplumCreds(creds: MedplumCreds): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(medplumCredsSchema.parse(creds)), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypt a stored envelope back to plaintext creds. Throws on an unknown
 * envelope shape, a wrong key, or tampered ciphertext (GCM auth failure).
 */
export function openMedplumCreds(stored: unknown): MedplumCreds {
  const parsed = sealedSecretSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(
      "tenants.medplum_client_creds is not a sealed-secret envelope. " +
        "Re-seed the tenant with `bun scripts/seed-tenant.ts`.",
    );
  }
  const { iv, ct, tag } = parsed.data;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return medplumCredsSchema.parse(JSON.parse(plaintext));
}
