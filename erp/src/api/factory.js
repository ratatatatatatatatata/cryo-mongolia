import { adapterContractError, validateAdapter } from "./contract.js";
import { createLocalDemoAdapter } from "./local-demo.js";
import { createSupabaseAdapter } from "./supabase-adapter.js";

export async function resolveApiAdapter(config, windowLike = globalThis.window) {
  if (config.mode === "local-demo") return createLocalDemoAdapter();

  const adapter = windowLike?.CRYO_ERP_ADAPTER ?? createSupabaseAdapter();
  const validation = validateAdapter(adapter);
  if (!validation.valid) throw adapterContractError(validation.missing);

  if (typeof adapter.configure === "function") {
    await adapter.configure({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
    });
  }

  return adapter;
}
