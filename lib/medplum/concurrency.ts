import type { Resource } from "@medplum/fhirtypes"

/** Request options for a FHIR version-aware update (HTTP If-Match / weak ETag). */
export function ifMatch(resource: Pick<Resource, "meta">): RequestInit {
  const versionId = resource.meta?.versionId
  if (!versionId) throw new Error("FHIR resource is missing meta.versionId.")
  return { headers: { "If-Match": `W/"${versionId}"` } }
}
