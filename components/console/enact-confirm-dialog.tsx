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
 * Confirm is deliberately not autofocused: a safety confirm must never fire on
 * a stray Enter.
 */
export function EnactConfirmDialog({
  open,
  onOpenChange,
  kind,
  patientName,
  patientMrn,
  actionText,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Drives the title: a drug substitution reads differently from a plain notify. */
  kind: "switch" | "notify"
  patientName: string
  patientMrn: string
  /** Plain-language sentence of what enact will do (built by the caller). */
  actionText: string
  /** The confirm button label, mirroring the enact button that opened this. */
  confirmLabel: string
  onConfirm: () => void
}) {
  const title =
    kind === "switch" ? "Confirm substitution" : "Confirm prescriber notification"

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
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
