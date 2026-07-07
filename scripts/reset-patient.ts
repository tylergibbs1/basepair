import { createMedplumClient } from "../lib/medplum/client";
const patientRef = process.argv[2];
const medplum = await createMedplumClient();
const tasks = await medplum.searchResources("Task", `patient=${patientRef}&status=requested`);
for (const t of tasks) {
  await medplum.updateResource({ ...t, status: "cancelled" });
  console.log("cancelled Task", t.id);
}
console.log(`reset ${tasks.length} task(s) for ${patientRef}`);
process.exit(0);
