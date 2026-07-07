import { runs } from "@trigger.dev/sdk";
const id = process.argv[2];
const r = await runs.retrieve(id);
console.log("status:", r.status);
console.log("error:", JSON.stringify(r.error, null, 2));
process.exit(0);
