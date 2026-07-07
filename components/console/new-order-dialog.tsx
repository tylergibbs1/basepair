"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PillIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { placeOrder, getOpenAlertCount } from "@/lib/alerts/actions"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Drugs the demo can order — each maps to a CPIC rule (or deliberately none). */
const DRUGS = [
  "clopidogrel",
  "capecitabine",
  "5-fluorouracil",
  "azathioprine",
  "mercaptopurine",
  "thioguanine",
  "simvastatin",
  "aspirin",
] as const

/** How long to watch for the async evaluation to flag an alert. The task now
 * includes an LLM verification step, so give it headroom over the ~15s the
 * deterministic-only path needed. */
const POLL_INTERVAL_MS = 2500
const POLL_TIMEOUT_MS = 25000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Phase = "idle" | "placing" | "evaluating"

export function NewOrderDialog({ patients }: { patients: OrderablePatient[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [patientRef, setPatientRef] = React.useState<string | null>(null)
  const [drug, setDrug] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<Phase>("idle")

  const busy = phase !== "idle"

  const patientItems = React.useMemo(
    () =>
      patients.map((p) => ({
        value: p.ref,
        label: `${p.name} · MRN ${p.mrn}`,
      })),
    [patients]
  )

  async function submitOrder() {
    if (!patientRef || !drug || busy) return

    // Baseline the open-alert count so we can tell when the async evaluation
    // (Subscription → Bot → task) flags a new one.
    let baseline = 0
    try {
      baseline = await getOpenAlertCount()
    } catch {
      // Non-fatal — we can still place the order and refresh.
    }

    setPhase("placing")
    try {
      await placeOrder(patientRef, drug)
    } catch {
      setPhase("idle")
      toast.error("Could not place the order", {
        description: "Check the Medplum connection, then try again.",
      })
      return
    }

    // Order is written and Basepair is now evaluating it against the patient's
    // genetics; watch the queue until an alert lands (or it clears).
    setPhase("evaluating")
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let flagged = false
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      router.refresh() // re-fetch the queue so a fresh alert can appear
      let count = baseline
      try {
        count = await getOpenAlertCount()
      } catch {
        continue
      }
      if (count > baseline) {
        flagged = true
        break
      }
    }

    if (flagged) {
      toast(`Alert flagged for ${drug}`)
    } else {
      toast(`Order placed — no alert (cleared) for ${drug}`)
    }

    router.refresh()
    setPhase("idle")
    setOpen(false)
    setDrug(null)
    setPatientRef(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let the dialog close mid-flight.
        if (busy) return
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <PillIcon aria-hidden />
            New Order…
          </Button>
        }
      />
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
          <DialogDescription>
            Write a medication order. Basepair evaluates it against the
            patient’s genetics and flags any risk.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="order-patient" className="text-sm">
              Patient
            </label>
            <Select
              items={patientItems}
              value={patientRef}
              onValueChange={(value) => setPatientRef(value as string)}
            >
              <SelectTrigger
                id="order-patient"
                className="w-full"
                disabled={busy}
              >
                <SelectValue placeholder="Select a patient…" />
              </SelectTrigger>
              <SelectContent>
                {patientItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="order-drug" className="text-sm">
              Drug
            </label>
            <Select
              value={drug}
              onValueChange={(value) => setDrug(value as string)}
            >
              <SelectTrigger id="order-drug" className="w-full" disabled={busy}>
                <SelectValue placeholder="Select a drug…" />
              </SelectTrigger>
              <SelectContent>
                {DRUGS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button onClick={submitOrder} disabled={busy || !patientRef || !drug}>
            {phase === "placing" ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Placing Order…
              </>
            ) : phase === "evaluating" ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Evaluating Order…
              </>
            ) : (
              "Place Order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
