import { checkForUpdate, type UpdateCheckResult } from "@/services/updateCheck";
import { useUpdateStore, type UpdateCheckSource } from "@/stores/updateStore";

export async function runUpdateCheck(source: UpdateCheckSource): Promise<UpdateCheckResult | null> {
  const state = useUpdateStore.getState();
  if (["checking", "downloading", "installing"].includes(state.status)) return null;
  useUpdateStore.getState().setChecking(source);
  if (state.update) await state.update.close().catch(() => {});
  try {
    const result = await checkForUpdate();
    useUpdateStore.getState().setResult(result, source);
    return result;
  } catch (error) {
    useUpdateStore.getState().setError(error, source);
    return null;
  }
}
