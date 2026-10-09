import type { Asset, OutfitDraft } from "./core/types";
import { fittingDraftMatches, type FittingSnapshot } from "./mirrorScene";
import { BackendError } from "./integrations/backendClient";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type SavedFittingLookup =
  | {
      status: "ready";
      operationId: string;
      resultId: string;
      blob: Blob;
      mediaKind: "image" | "video";
    }
  | { status: "unavailable"; message: string }
  | { status: "stale"; message: string };
/** Reads a matching DB result and its private stored bytes. Never polls/submits to a provider or falls back to live. */
export async function lookupSavedFitting(
  input: {
    draft: OutfitDraft;
    person: Asset;
    reference: Asset;
    snapshot: FittingSnapshot;
  },
  ports: {
    request: (
      path: string,
      method: string,
      body: unknown,
    ) => Promise<Record<string, unknown>>;
    fetch: typeof fetch;
    isCurrent: () => boolean;
  },
): Promise<SavedFittingLookup> {
  const stale = (): SavedFittingLookup => ({
    status: "stale",
    message: "변경되거나 종료된 인물·코디의 저장 결과는 적용하지 않았습니다.",
  });
  const unavailable = (): SavedFittingLookup => ({
    status: "unavailable",
    message:
      "현재 인물 영상·코디 참조·전체 코디와 일치하는 저장된 피팅 결과가 없습니다. 새 API 실행은 하지 않았습니다.",
  });
  if (!ports.isCurrent()) return stale();
  const { draft, person, reference, snapshot } = structuredClone(input);
  const selected = Object.entries(draft.items);
  if (
    !fittingDraftMatches(snapshot, draft) ||
    draft.ownerId !== snapshot.ownerId ||
    draft.draftId !== snapshot.outfit.draftId ||
    draft.revision !== snapshot.outfit.revision ||
    selected.length !== snapshot.outfit.items.length ||
    selected.some(
      ([slot, id]) =>
        !snapshot.outfit.items.some(
          (item) => item.slot === slot && item.garmentId === id,
        ),
    ) ||
    [person, reference].some(
      (asset) =>
        asset.source !== "storage" ||
        !uuid.test(asset.id) ||
        !Number.isSafeInteger(asset.version) ||
        asset.version < 1,
    )
  ) {
    throw new Error(
      "현재 인물·코디와 비공개 입력 자산의 참조를 먼저 확인해 주세요.",
    );
  }
  let response: Record<string, unknown>;
  try {
    response = await ports.request("/api/try-on", "POST", {
      mode: "saved_result",
      intent_key: crypto.randomUUID(),
      draft,
      person_asset_id: person.id,
      reference_asset_id: reference.id,
      fitting_mode: "batch",
    });
  } catch (error) {
    if (!ports.isCurrent()) return stale();
    if (error instanceof BackendError && error.code === "result_unavailable")
      return unavailable();
    throw error;
  }
  if (!ports.isCurrent()) return stale();
  if (
    response.mode !== "saved_result" ||
    response.processing_status !== "succeeded" ||
    response.apply_status !== "not_applied" ||
    typeof response.operation_id !== "string" ||
    !uuid.test(response.operation_id) ||
    typeof response.result_asset_id !== "string" ||
    !uuid.test(response.result_asset_id)
  )
    return unavailable();
  // This endpoint returns already stored private bytes; /try-on/:id/result may acquire a new provider result and is deliberately not used.
  const media = await ports.fetch(
    `/api/assets/${response.result_asset_id}/content`,
    { method: "GET", credentials: "same-origin", cache: "no-store" },
  );
  if (!ports.isCurrent()) return stale();
  if (media.status === 404) return unavailable();
  if (!media.ok)
    throw new Error(
      "저장된 피팅 파일을 읽지 못했습니다. 로그인과 접근 권한을 확인해 주세요.",
    );
  const mime = (media.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/webm",
    ].includes(mime)
  )
    return unavailable();
  const blob = await media.blob();
  if (!ports.isCurrent()) return stale();
  if (!blob.size) return unavailable();
  return {
    status: "ready",
    operationId: response.operation_id,
    resultId: response.result_asset_id,
    blob,
    mediaKind: mime.startsWith("image/") ? "image" : "video",
  };
}
