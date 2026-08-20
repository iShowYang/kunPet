import { cleanupKunPetHook } from "./hook-manager";
import {
  cleanupAllElectronRuntimeCaches,
  cleanupElectronRuntimeAt,
} from "./runtime-cleanup";

async function main(): Promise<void> {
  const removed = cleanupAllElectronRuntimeCaches();
  if (removed > 0) {
    console.log(`kunPet: removed Electron runtime cache from ${removed} location(s)`);
  }

  await cleanupKunPetHook();
  console.log("kunPet: uninstall cleanup finished");
}

void main().catch((err) => {
  console.error("kunPet uninstall cleanup failed:", err);
  process.exit(0);
});

export { cleanupElectronRuntimeAt };
