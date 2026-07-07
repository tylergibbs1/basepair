import { db } from "../lib/db/client";
import { tenants } from "../lib/db/schema";
const rows = await db.select().from(tenants);
console.log("runtime pooler OK, tenants rows:", rows.length);
process.exit(0);
