// TEMPORARY verification script — proves the Realtime wiring end-to-end:
// trigger the real task, then subscribe using the run's publicAccessToken (the
// exact token/path the browser's useRealtimeRun uses) and watch the phase
// metadata stream to completion. Delete after running.
import { tasks, runs } from "@trigger.dev/sdk"
import { getOrderablePatients } from "@/lib/alerts/orderable"

const TERMINAL_FAIL = [
  "FAILED",
  "CRASHED",
  "CANCELED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "EXPIRED",
]

const killer = setTimeout(() => {
  console.error("TIMEOUT — no completion in 120s")
  process.exit(2)
}, 120_000)

const patients = await getOrderablePatients()
if (patients.length === 0) {
  console.error("no orderable patients found")
  process.exit(1)
}
const p = patients[0]
console.log(`patient: ${p.name} (${p.ref})`)

const handle = await tasks.trigger("evaluate-order", {
  patientRef: p.ref,
  drug: "aspirin",
  orderedBy: "Realtime Verify",
})
console.log(`runId: ${handle.id}`)
console.log(
  `publicAccessToken: ${
    typeof handle.publicAccessToken === "string" &&
    handle.publicAccessToken.length > 20
      ? "OK (" + handle.publicAccessToken.slice(0, 12) + "…)"
      : "MISSING"
  }`
)

let lastStatus = ""
let lastPhase = ""
// Subscribe with the PUBLIC token — same stream the frontend hook consumes.
for await (const run of runs.subscribeToRun(handle.id, {
  accessToken: handle.publicAccessToken,
})) {
  const phase = JSON.stringify(run.metadata ?? null)
  if (run.status !== lastStatus || phase !== lastPhase) {
    console.log(`  status=${run.status}  metadata=${phase}`)
    lastStatus = run.status
    lastPhase = phase
  }
  if (run.status === "COMPLETED") {
    console.log(`output: ${JSON.stringify(run.output)}`)
    break
  }
  if (TERMINAL_FAIL.includes(run.status)) {
    console.log(`run ended: ${run.status}`, run.error ?? "")
    break
  }
}

clearTimeout(killer)
process.exit(0)
