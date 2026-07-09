"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import type { GovernanceThresholdConfig } from "@/lib/alerts/governance"
import { saveGovernanceThresholds } from "@/lib/alerts/governance-config"
import { auth } from "@/lib/auth"

export async function saveGovernanceThresholdsAction(
  config: GovernanceThresholdConfig,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) throw new Error("Unauthorized")
  await saveGovernanceThresholds(config)
  revalidatePath("/audit")
}
