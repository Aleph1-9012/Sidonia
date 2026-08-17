import { collectSourceLock, sourceSummary, writeSourceLock } from "./source-evidence.js";
import { errorMessage } from "./common.js";
import { verifyCanonicalSourcePacks } from "./verify-sources.js";

const main = async (): Promise<void> => {
  const lock = await collectSourceLock();
  await verifyCanonicalSourcePacks(lock);
  await writeSourceLock(lock);
  console.log(sourceSummary(lock));
};

main().catch((cause: unknown) => {
  console.error(`source lock failed: ${errorMessage(cause)}`);
  process.exitCode = 1;
});
