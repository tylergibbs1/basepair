import { createMedplumClient } from "../lib/medplum/client";
const medplum = await createMedplumClient();
const open = await medplum.searchResources("Task", { status: "requested", _count: 100 });
for (const t of open) await medplum.updateResource({ ...t, status: "cancelled" });
console.log(`cancelled ${open.length} open task(s)`);
process.exit(0);
