import { api } from "./integrations/backendClient";
export async function pollJob(path: string) {
  for (let i = 0; i < 120; i++) {
    const row: any = await api().get(path);
    if (["SUCCEEDED", "READY"].includes(row.status)) return row;
    if (["FAILED", "TIMED_OUT", "CANCELLED"].includes(row.status))
      throw new Error("작업 실패 · 저장되지 않았습니다.");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("작업 시간 초과 · 다시 상태를 확인하세요.");
}
export async function renderCard(
  outfitId: string,
  visibility: "PRIVATE" | "SHAREABLE" = "PRIVATE",
) {
  const draft: any = await api().send("POST", "/cards/drafts", {
    outfit_id: outfitId,
    template_id: "minimal-v1",
  });
  const job: any = await api().send("POST", "/card-render-jobs", {
    card_id: draft.id,
    output_format: "PNG",
    width: 1080,
    height: 1350,
  });
  await pollJob(`/jobs/${job.job_id}`);
  return api().send("POST", `/cards/${draft.id}/save`, {
    visibility,
    reuse_outfit: false,
  });
}
