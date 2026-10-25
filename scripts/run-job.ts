// Runs one background job now, for testing: npx tsx scripts/run-job.ts <name>
// Names: expire-claims, expire-stale-listings, auto-run-draws, push-queue, http-queue.
// push-queue and http-queue really send (Expo/FCM/Telegram): only run them on purpose.
import { pool } from "../src/db/client";
import { allJobs } from "../src/jobs";
import { runJob } from "../src/jobs/scheduler";

const job = allJobs.find((j) => j.name === process.argv[2]);
if (!job) {
  console.error(`Usage: npx tsx scripts/run-job.ts <${allJobs.map((j) => j.name).join(" | ")}>`);
  process.exit(1);
}
console.log(JSON.stringify(await runJob(job), null, 1));
await pool.end();
