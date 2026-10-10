import { api, currentMember } from "./integrations/backendClient";
import { pollJob } from "./serverActions";
import type { Garment, Outfit, OutfitItems } from "./core/types";

export async function todayServerRecommendation(
  garments: readonly Garment[],
  check: () => void,
) {
  const member = currentMember();
  if (!member) throw Error("로그인 후 내 옷 추천을 요청하세요.");
  const client = api();
  check();
  const context: any = await client.send("POST", "/context-snapshots", {
    member_id: member.id,
    timezone: "Asia/Seoul",
    mode: "MOCK",
  });
  check();
  const result: any = await client.send("POST", "/outfit-recommendations", {
    member_id: member.id,
    context_snapshot_id: context.id,
    constraints: {},
    limit: 3,
  });
  check();
  return result.candidates.map((candidate: any) => {
    const raw = candidate.outfit;
    const items = Object.fromEntries(
      raw.items.map((i: any) => [i.slot.toLowerCase(), i.garment_id]),
    ) as OutfitItems;
    const selected = Object.values(items).map((id) =>
      garments.find((g) => g.id === id),
    );
    if (selected.some((g) => !g))
      throw Error(
        "현재 접근 가능한 의류와 추천 구성이 다릅니다. 다시 조회하세요.",
      );
    const outfit: Outfit = {
      id: raw.id,
      ownerId: member.id,
      name: raw.title,
      revision: raw.version,
      items,
      assetIds: Object.fromEntries(
        selected.map((g) => [g!.id, g!.asset?.id ?? null]),
      ),
      assetVersions: Object.fromEntries(
        selected.map((g) => [g!.id, g!.asset?.version ?? 0]),
      ),
    };
    return { outfit, reasons: candidate.reasons as string[] };
  }) as { outfit: Outfit; reasons: string[] }[];
}

export async function homeServerStorageAdvice(check: () => void) {
  const member = currentMember();
  if (!member) throw Error("로그인 후 보관 추천을 요청하세요.");
  const client = api();
  check();
  const job: any = await client.send("POST", "/storage-optimization-jobs", {
    household_id: member.household_id,
    member_id: member.id,
    mode: "WEAR_PATTERN",
    dry_run: true,
    season: "ALL",
    analysis_window_days: 90,
    garment_ids: [],
  });
  check();
  const result: any = await pollJob(`/jobs/${job.job_id}`, client, check);
  check();
  return result.storage_result;
}
