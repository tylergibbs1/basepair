import "server-only"

import type { Basic } from "@medplum/fhirtypes"
import { z } from "zod"

import {
  DEFAULT_GOVERNANCE_THRESHOLDS,
  type GovernanceThresholdConfig,
} from "@/lib/alerts/governance"
import { createMedplumClient, defaultTenantId } from "@/lib/medplum/client"

const IDENTIFIER_SYSTEM = "https://basepair.health/governance-config"
const EXTENSION_URL =
  "https://basepair.health/fhir/StructureDefinition/governance-thresholds"

const schema = z.object({
  minReviewed: z.number().int().min(1).max(100),
  falseAlarmRateThreshold: z.number().min(0).max(1),
  dismissalRateThreshold: z.number().min(0).max(1),
  agentAnomalyThreshold: z.number().int().min(1).max(100),
})

function tenantKey(): string {
  return defaultTenantId() ?? "environment-default"
}

async function findConfig(): Promise<Basic | undefined> {
  const medplum = await createMedplumClient()
  const resources = await medplum.searchResources("Basic", {
    identifier: `${IDENTIFIER_SYSTEM}|${tenantKey()}`,
    _count: 1,
  })
  return resources[0]
}

export async function getGovernanceThresholds(): Promise<GovernanceThresholdConfig> {
  try {
    const resource = await findConfig()
    const raw = resource?.extension?.find(
      (extension) => extension.url === EXTENSION_URL,
    )?.valueString
    if (!raw) return DEFAULT_GOVERNANCE_THRESHOLDS
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_GOVERNANCE_THRESHOLDS
  } catch (error) {
    console.error("getGovernanceThresholds failed; using defaults", error)
    return DEFAULT_GOVERNANCE_THRESHOLDS
  }
}

export async function saveGovernanceThresholds(
  input: GovernanceThresholdConfig,
): Promise<GovernanceThresholdConfig> {
  const config = schema.parse(input)
  const medplum = await createMedplumClient()
  const existing = await findConfig()
  const next: Basic = {
    ...(existing ?? {}),
    resourceType: "Basic",
    identifier: [{ system: IDENTIFIER_SYSTEM, value: tenantKey() }],
    code: {
      coding: [
        {
          system: IDENTIFIER_SYSTEM,
          code: "alert-governance-thresholds",
          display: "Alert governance thresholds",
        },
      ],
    },
    extension: [
      {
        url: EXTENSION_URL,
        valueString: JSON.stringify(config),
      },
    ],
  }
  if (existing?.id) await medplum.updateResource(next)
  else await medplum.createResource(next)
  return config
}
