import { AuditSkeleton } from "@/components/console/audit-skeleton"

// Next 16 App Router: automatically wrapped in a <Suspense> boundary around the
// audit page. That page is a server component that awaits Medplum on every
// render, so this fallback genuinely shows on each visit — it mirrors the
// loaded trail (description line + table) for a shift-free hand-off.
export default function Loading() {
  return <AuditSkeleton />
}
