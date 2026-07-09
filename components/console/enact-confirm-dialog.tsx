"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDob } from "@/lib/alerts/types"
import type { FormularyStatus } from "@/lib/alerts/local-action"

/**
 * The wrong-patient guard: a patient-identity confirm shown before ENACT.
 *
 * Enact is the one triage action that writes outward — a prescriber
 * Communication always, and a substitute MedicationRequest for a switch — which
 * Undo can soften but can't fully un-ring once a prescriber has seen it. So,
 * unlike approve and dismiss (both internal and cleanly reversible), it earns a
 * pre-write gate: the pharmacist verifies *who* the order is for before it
 * fires. The post-write Undo still stands; this is the added front door.
 *
 * The identity block reuses the detail header's idiom (name prominent, MRN in
 * quiet mono) because that identity is exactly what's being verified — it must
 * read clearly, not as fine print. base-ui Dialog supplies the focus trap,
 * Escape, and aria wiring; the action sentence is the accessible description.
 * (Context7-confirmed for @base-ui/react v1.6.0: Dialog children are free-form
 * ReactNode, so the local-formulary section sits cleanly between header and
 * footer, and DialogDescription remains the accessible description.)
 * Confirm is deliberately not autofocused: a safety confirm must never fire on
 * a stray Enter.
 */
export function EnactConfirmDialog({
  open,
  onOpenChange,
  kind,
  patientName,
  patientMrn,
  patientDob,
  actionText,
  localAction,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Drives the title: a drug substitution reads differently from a plain notify. */
  kind: "switch" | "notify"
  patientName: string
  patientMrn: string
  /** ISO 8601 date of birth, the second identifier for the wrong-patient check.
   *  Omitted from the block when absent — never shown as "Invalid Date". */
  patientDob?: string
  /** Plain-language sentence of what enact will do (built by the caller). */
  actionText: string
  /**
   * #48: the LOCAL formulary rationale for the substitution, so the enact
   * confirmation shows guideline support (actionText) PLUS why this local
   * alternative was chosen. Passed only for an enactable local switch; absent
   * for a dose/avoid/notify path (nothing local to add — renders nothing).
   */
  localAction?: {
    /** planLocalAction's rationale for the selected alternative. */
    rationale: string
    /** The selected alternative drug (for the section heading). */
    selectedDrug?: string
    /** Its local formulary status, e.g. "preferred". */
    status?: FormularyStatus
  }
  /** The confirm button label, mirroring the enact button that opened this. */
  confirmLabel: string
  onConfirm: () => void
}) {
  const title =
    kind === "switch" ? "Confirm substitution" : "Confirm prescriber notification"
  // A second identifier alongside the MRN: the wrong-patient guard is stronger
  // when name + MRN + DOB agree. Degrades to nothing when no DOB is on file.
  const dob = formatDob(patientDob)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{actionText}</DialogDescription>
        </DialogHeader>
        {/* Identity being verified — prominent, not fine print. */}
        <div className="rounded-md border border-border bg-secondary/40 px-4 py-3">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {patientName}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {patientMrn}
            </span>
            {dob && (
              <span className="text-xs tabular-nums text-muted-foreground">
                DOB {dob}
              </span>
            )}
          </div>
        </div>
        {/* #48: the local formulary rationale, beneath the identity block —
            guideline support (the action sentence above) PLUS why this local
            alternative was picked. Rendered only when a local switch plan was
            passed; a dose/avoid/notify enact shows nothing extra here. */}
        {localAction && (
          <div className="rounded-md border border-border bg-secondary/25 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Local formulary
              </span>
              {localAction.selectedDrug && (
                <span className="rounded-sm border bg-background px-2 py-1 text-xs font-medium text-foreground">
                  {localAction.selectedDrug}
                  {localAction.status ? ` · ${localAction.status}` : ""}
                </span>
              )}
            </div>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-foreground">
              {localAction.rationale}
            </p>
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
