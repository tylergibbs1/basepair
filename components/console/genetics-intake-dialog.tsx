"use client"

import * as React from "react"
import {
  FileTextIcon,
  Loader2Icon,
  PaperclipIcon,
  ScanTextIcon,
  XIcon,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"

import {
  ingestAndEvaluate,
  parseReport,
  type ExtractionResult,
} from "@/lib/genetics/actions"
import type { ParseSource } from "@/lib/ai/parse-genetics"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import { DRUGS, PRESCRIBERS } from "@/lib/orders"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SeverityChip } from "@/components/ui/severity-chip"
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
import {
  EvaluationStepper,
  OrderEvaluation,
  type Phase,
} from "@/components/console/new-order-dialog"

/** File types the parser accepts as a dropped/attached report. */
const ACCEPT = "application/pdf,image/*"
const MAX_BYTES = 8 * 1024 * 1024

type Attached = { name: string; data: string; mediaType: string }

/** Read a File into the base64 `data` a `file` ParseSource needs. */
function readFile(file: File): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read the file."))
    reader.onload = () => {
      const result = String(reader.result)
      // data URL is "data:<mime>;base64,<payload>" — keep only the payload.
      const data = result.slice(result.indexOf(",") + 1)
      resolve({
        name: file.name,
        data,
        mediaType: file.type || "application/octet-stream",
      })
    }
    reader.readAsDataURL(file)
  })
}

type Step = "input" | "review"

/**
 * Messy-input intake (issue #4): paste a free-text genetics note or drop a
 * PDF/image of a lab report, and Claude extracts a structured
 * `{ gene, diplotype, phenotype? }`. The extraction is held for pharmacist
 * confirmation — the model parses, it never decides — then written to Medplum as
 * coded genomic Observation(s) the existing engine reads, and the order is
 * evaluated end-to-end (the same stepper New Order shows).
 */
export function GeneticsIntakeDialog({
  patients,
  open,
  onOpenChange,
  showTrigger = true,
}: {
  patients: OrderablePatient[]
  open: boolean
  onOpenChange: (open: boolean) => void
  showTrigger?: boolean
}) {
  const [step, setStep] = React.useState<Step>("input")

  // Input phase.
  const [patientRef, setPatientRef] = React.useState<string | null>(null)
  const [drug, setDrug] = React.useState<string | null>(null)
  const [prescriber, setPrescriber] = React.useState<string>(PRESCRIBERS[0])
  const [reportText, setReportText] = React.useState("")
  const [attached, setAttached] = React.useState<Attached | null>(null)
  const [parsing, setParsing] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  // Review phase.
  const [extraction, setExtraction] = React.useState<ExtractionResult | null>(
    null,
  )
  const [included, setIncluded] = React.useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = React.useState(false)

  // Evaluating phase (reuses New Order's live stepper).
  const [submission, setSubmission] = React.useState<{
    runId: string
    accessToken: string
  } | null>(null)
  const [runPhase, setRunPhase] = React.useState<Phase | null>(null)

  const phase: Phase = submission ? (runPhase ?? "genetics") : "idle"
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"
  // Any live work locks the dialog closed; a resolved outcome can be dismissed.
  const inFlight = parsing || submitting || (Boolean(submission) && !resolved)

  const patientItems = React.useMemo(
    () =>
      patients.map((p) => ({
        value: p.ref,
        label: `${p.name} · MRN ${p.mrn}`,
      })),
    [patients],
  )

  const reset = React.useCallback(() => {
    setStep("input")
    setPatientRef(null)
    setDrug(null)
    setReportText("")
    setAttached(null)
    setParsing(false)
    setDragging(false)
    setExtraction(null)
    setIncluded(new Set())
    setSubmitting(false)
    setSubmission(null)
    setRunPhase(null)
    onOpenChange(false)
  }, [onOpenChange])

  const takeFile = React.useCallback(async (file: File | null | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error("That file is too large", {
        description: "Attach a report under 8 MB, or paste the text instead.",
      })
      return
    }
    try {
      setAttached(await readFile(file))
    } catch {
      toast.error("Could not read that file", {
        description: "Try a different export, or paste the text instead.",
      })
    }
  }, [])

  const canExtract =
    Boolean(patientRef) &&
    Boolean(drug) &&
    (attached !== null || reportText.trim().length > 0) &&
    !parsing

  async function extract() {
    if (!canExtract) return
    const source: ParseSource = attached
      ? {
          kind: "file",
          data: attached.data,
          mediaType: attached.mediaType,
          filename: attached.name,
        }
      : { kind: "text", text: reportText }

    setParsing(true)
    try {
      const result = await parseReport(source)
      setExtraction(result)
      // Default-include every gene that carries a usable diplotype; the
      // pharmacist can still drop a flagged row before confirming.
      setIncluded(
        new Set(
          result.genes
            .map((g, i) => (g.diplotype ? i : -1))
            .filter((i) => i >= 0),
        ),
      )
      setStep("review")
      if (result.genes.length === 0) {
        toast("No pharmacogenomic result found", {
          description: "The report did not contain a gene the engine can use.",
        })
      }
    } catch {
      toast.error("Could not read the report", {
        description: "The parser failed. Check the AI connection, then retry.",
      })
    } finally {
      setParsing(false)
    }
  }

  const includedGenes = React.useMemo(
    () =>
      extraction
        ? extraction.genes.filter((_, i) => included.has(i))
        : [],
    [extraction, included],
  )

  async function confirm() {
    if (!patientRef || !drug || includedGenes.length === 0 || submitting) return
    setSubmitting(true)
    try {
      const result = await ingestAndEvaluate({
        patientRef,
        genes: includedGenes.map((g) => ({
          gene: g.gene,
          diplotype: g.diplotype,
          phenotype: g.phenotype || undefined,
        })),
        drug,
        orderedBy: prescriber,
      })
      setSubmission({
        runId: result.runId,
        accessToken: result.accessToken,
      })
    } catch {
      toast.error("Could not write the genetics", {
        description: "Check the Medplum connection, then try again.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const toggle = (i: number) =>
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (inFlight) return
        if (next) onOpenChange(true)
        else reset()
      }}
    >
      {showTrigger && (
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <ScanTextIcon aria-hidden />
              Read Report…
            </Button>
          }
        />
      )}
      <DialogContent showCloseButton={!inFlight} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Read Genetics Report</DialogTitle>
          <DialogDescription>
            {submission
              ? "Basepair is evaluating the confirmed genetics against the order."
              : step === "review"
                ? "Confirm what Basepair extracted before it is written and used."
                : "Paste a note or attach a PDF/image. Basepair extracts the structured result the EHR could not read."}
          </DialogDescription>
        </DialogHeader>

        {/* Headless live-run subscriber (reused from New Order). */}
        {submission && (
          <OrderEvaluation
            runId={submission.runId}
            accessToken={submission.accessToken}
            drug={drug ?? ""}
            onPhaseChange={setRunPhase}
            onClose={reset}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {submission ? (
            <motion.div
              key="stepper"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.moderate.exit }}
              transition={spring.moderate}
            >
              <EvaluationStepper phase={phase} />
            </motion.div>
          ) : step === "review" && extraction ? (
            <motion.div
              key="review"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.moderate.exit }}
              transition={spring.moderate}
              className="grid gap-3"
            >
              {extraction.genes.length === 0 ? (
                <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  No gene result was found in the report. Go back and paste more
                  of the note, or attach the lab PDF.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {extraction.genes.map((g, i) => {
                    const usable = Boolean(g.diplotype)
                    const checked = included.has(i)
                    return (
                      <li
                        key={`${g.gene}-${i}`}
                        className={cn(
                          "rounded-sm border border-border p-3",
                          !usable && "opacity-60",
                        )}
                      >
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-foreground"
                            checked={checked}
                            disabled={!usable}
                            onChange={() => toggle(i)}
                          />
                          <div className="grid flex-1 gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium tabular-nums">
                                {g.gene} {g.diplotype || "—"}
                              </span>
                              {g.needsReview ? (
                                <SeverityChip severity="caution">
                                  Needs review
                                </SeverityChip>
                              ) : (
                                <SeverityChip severity="success">
                                  Ready
                                </SeverityChip>
                              )}
                            </div>
                            {g.phenotype && (
                              <span className="text-sm text-muted-foreground">
                                {g.phenotype}
                                <span className="text-xs">
                                  {g.phenotypeSource === "catalog"
                                    ? " · CPIC-resolved"
                                    : " · from report"}
                                </span>
                              </span>
                            )}
                            {!usable && (
                              <span className="text-xs text-sev-caution-fg">
                                No genotype in the report — cannot be used.
                              </span>
                            )}
                            {g.evidence && (
                              <span className="text-xs text-muted-foreground italic">
                                “{g.evidence}”
                              </span>
                            )}
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              {extraction.notes && (
                <p className="rounded-sm border border-sev-caution-br bg-sev-caution-bg p-2.5 text-xs text-sev-caution-fg">
                  {extraction.notes}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Extracted by {extraction.model}. The model parses the report; you
                confirm what gets used.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.moderate.exit }}
              transition={spring.moderate}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <label htmlFor="intake-patient" className="text-sm">
                  Patient
                </label>
                <Select
                  items={patientItems}
                  value={patientRef}
                  onValueChange={(value) => setPatientRef(value as string)}
                >
                  <SelectTrigger
                    id="intake-patient"
                    className="w-full"
                    disabled={parsing}
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
                <label htmlFor="intake-drug" className="text-sm">
                  Drug to evaluate
                </label>
                <Select
                  value={drug}
                  onValueChange={(value) => setDrug(value as string)}
                >
                  <SelectTrigger
                    id="intake-drug"
                    className="w-full"
                    disabled={parsing}
                  >
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

              <div className="grid gap-2">
                <label htmlFor="intake-report" className="text-sm">
                  Report
                </label>
                {/* Drop target doubles as the paste box: a dropped PDF/image
                    attaches; typed/pasted text is parsed as a note. */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    void takeFile(e.dataTransfer.files?.[0])
                  }}
                  className={cn(
                    "rounded-sm border border-dashed transition-colors",
                    dragging ? "border-foreground bg-muted/40" : "border-input",
                  )}
                >
                  {attached ? (
                    <div className="flex items-center gap-2 p-3 text-sm">
                      <FileTextIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1 truncate">{attached.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label="Remove attachment"
                        onClick={() => setAttached(null)}
                        disabled={parsing}
                      >
                        <XIcon aria-hidden className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <textarea
                      id="intake-report"
                      value={reportText}
                      onChange={(e) => setReportText(e.target.value)}
                      disabled={parsing}
                      rows={5}
                      placeholder="Paste the genetics note here, or drop a PDF/image…"
                      className="w-full resize-y bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  )}
                </div>
                {!attached && (
                  <div>
                    <label
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground",
                        parsing && "pointer-events-none opacity-50",
                      )}
                    >
                      <PaperclipIcon aria-hidden className="size-3.5" />
                      Attach a PDF or image instead
                      <input
                        type="file"
                        accept={ACCEPT}
                        className="sr-only"
                        disabled={parsing}
                        onChange={(e) => {
                          void takeFile(e.target.files?.[0])
                          e.target.value = ""
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <label htmlFor="intake-prescriber" className="text-sm">
                  Prescriber
                </label>
                <Select
                  value={prescriber}
                  onValueChange={(value) => setPrescriber(value as string)}
                >
                  <SelectTrigger
                    id="intake-prescriber"
                    className="w-full"
                    disabled={parsing}
                  >
                    <SelectValue placeholder="Select a prescriber…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESCRIBERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter>
          {submission ? (
            <DialogClose
              render={<Button variant="outline" disabled={inFlight} />}
            >
              Close
            </DialogClose>
          ) : step === "review" ? (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("input")}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                onClick={confirm}
                disabled={submitting || includedGenes.length === 0}
              >
                {submitting ? (
                  <>
                    <Loader2Icon aria-hidden className="animate-spin" />
                    Writing Genetics…
                  </>
                ) : (
                  "Confirm & Evaluate"
                )}
              </Button>
            </>
          ) : (
            <>
              <DialogClose
                render={<Button variant="outline" disabled={parsing} />}
              >
                Cancel
              </DialogClose>
              <Button onClick={extract} disabled={!canExtract}>
                {parsing ? (
                  <>
                    <Loader2Icon aria-hidden className="animate-spin" />
                    Reading Report…
                  </>
                ) : (
                  "Extract Genetics"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
