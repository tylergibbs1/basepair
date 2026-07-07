import { createMedplumClient } from "../lib/medplum/client";
import { PGX_ALERT_EXTENSION_URL } from "../lib/medplum/fhir";
const medplum = await createMedplumClient();
const tasks = await medplum.searchResources("Task", "status=requested&_count=50");
console.log("open Tasks:", tasks.length);
let withExt = 0;
for (const t of tasks) {
  const ref = t.focus?.reference;
  if (!ref) continue;
  const di = await medplum.readReference(t.focus!);
  const ext = (di as any).extension?.find((e: any) => e.url === PGX_ALERT_EXTENSION_URL);
  if (ext) {
    withExt++;
    if (withExt === 1) console.log("sample pgx-alert:", ext.valueString);
  }
}
console.log("Tasks whose DetectedIssue has the pgx-alert extension:", withExt, "/", tasks.length);
process.exit(0);
