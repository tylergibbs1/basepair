import "server-only"

import type { Basic } from "@medplum/fhirtypes"
import { z } from "zod"

import {
  DEFAULT_GOVERNANCE_THRESHOLDS,
  type GovernanceThresholdConfig,
} from "@/lib/alerts/governance"
import { createMedplumClient } from "@/lib/medplum/client"
import { ifMatch } from "@/lib/medplum/concurrency"

const IDENTIFIER_SYSTEM = "https://basepair.health/governance-config"
const EXTENSION_URL =
  "https://basepair.health/fhir/StructureDefinition/governance-thresholds"

const schema = z.object({
  minReviewed: z.number().int().min(1).max(100),
  falseAlarmRateThreshold: z.number().min(0).max(1),
  dismissalRateThreshold: z.number().min(0).max(1),
  agentAnomalyThreshold: z.number().int().min(1).max(100),
})

async function findConfig(tenantId: string): Promise<Basic | undefined> {
  const medplum = await createMedplumClient(tenantId)
  const resources = await medplum.searchResources("Basic", {
    identifier: `${IDENTIFIER_SYSTEM}|${tenantId}`,
    _count: 1,
  })
  return resources[0]
}

export async function getGovernanceThresholds(
  tenantId: string
): Promise<GovernanceThresholdConfig> {
  try {
    const resource = await findConfig(tenantId)
    const raw = resource?.extension?.find(
      (extension) => extension.url === EXTENSION_URL
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
  tenantId: string,
  input: GovernanceThresholdConfig
): Promise<GovernanceThresholdConfig> {
  const config = schema.parse(input)
  const medplum = await createMedplumClient(tenantId)
  const existing = await findConfig(tenantId)
  const next: Basic = {
    ...existing,
    resourceType: "Basic",
    identifier: [{ system: IDENTIFIER_SYSTEM, value: tenantId }],
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
  if (existing?.id) await medplum.updateResource(next, ifMatch(existing))
  else await medplum.createResource(next)
  return config
}
