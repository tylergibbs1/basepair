"use server"

import { revalidatePath } from "next/cache"

import type { GovernanceThresholdConfig } from "@/lib/alerts/governance"
import { saveGovernanceThresholds } from "@/lib/alerts/governance-config"
import { requireConsolePrincipal } from "@/lib/authz"

export async function saveGovernanceThresholdsAction(
  config: GovernanceThresholdConfig
): Promise<void> {
  const principal = await requireConsolePrincipal(["admin", "safety-officer"])
  await saveGovernanceThresholds(principal.tenantId, config)
  revalidatePath("/audit")
}
