import {
  api,
  currentMember,
  currentDevice,
} from "./integrations/backendClient";
import { isISODate } from "./core/repository";
import { pollJob } from "./serverActions";
import { app } from "./appInstance";
import { outfitAssetRefs } from "./core/outfitAssets";
import type { OutfitDraft } from "./core/types";
import { completeOutfit, hasExternalItems } from "./core/externalOutfits";

type Journal = {
  body: string;
  keys: Record<string, string>;
  results: Record<string, any>;
  requests?: Record<
    string,
    { method: string; path: string; body: unknown; options: object }
  >;
};
const running = new Set<string>();

/** Persist the original command before sending it. An uncertain response reuses its key/body. */
export async function serverCommand<T>(
  identity: string,
  payload: unknown,
  operation: (
    step: (
      name: string,
      method: string,
      path: string,
      body: unknown,
      options?: object,
    ) => Promise<any>,
    check: () => void,
  ) => Promise<T>,
): Promise<T> {
  const owner = currentMember()?.id,
    repository = app.repository;
  if (!owner || app.connection.kind !== "supabase")
    throw Error("로그인이 필요합니다.");
  const storageKey = `smartcloset.server-command.v1:${owner}:${identity}`;
  if (running.has(storageKey)) throw Error("같은 요청의 결과를 확인 중입니다.");
  const check = () => {
    if (currentMember()?.id !== owner || app.repository !== repository)
      throw Error("계정이 변경되어 이전 요청을 중단했습니다.");
  };
  const body = JSON.stringify(payload);
  const existing = sessionStorage.getItem(storageKey);
  const journal: Journal = existing
    ? JSON.parse(existing)
    : { body, keys: {}, results: {} };
  if (journal.body !== body)
    throw Error("앞선 요청과 입력이 다릅니다. 원래 요청을 확인하세요.");
  const persist = () =>
    sessionStorage.setItem(storageKey, JSON.stringify(journal));
  persist();
  const client = api();
  const step = async (
    name: string,
    method: string,
    path: string,
    value: unknown,
    options = {},
  ) => {
    check();
    if (Object.hasOwn(journal.results, name)) return journal.results[name];
    journal.keys[name] ??= crypto.randomUUID();
    persist();
    journal.requests ??= {};
    journal.requests[name] ??= { method, path, body: value, options };
    persist();
    const original = journal.requests[name];
    const result = await client.send(
      original.method,
      original.path,
      original.body,
      { key: journal.keys[name], ...original.options },
    );
    journal.results[name] = result;
    persist();
    check();
    return result;
  };
  running.add(storageKey);
  try {
    return await operation(step, check);
  } finally {
    running.delete(storageKey);
  }
}

export async function confirmServerLook(draft: OutfitDraft) {
  if (!completeOutfit(draft) || hasExternalItems(draft))
    throw Error("확정은 보유 의류의 완성된 조합에서만 가능합니다.");
  outfitAssetRefs(draft, app.garments(), true);
  const device = currentDevice();
  const payload = {
    owner: draft.ownerId,
    items: draft.items,
    title: draft.name,
    device,
  };
  return serverCommand(
    `selection:${draft.draftId}:${draft.revision}`,
    payload,
    async (step) => {
      const outfit = await step("outfit", "POST", "/outfits", {
        title: draft.name || "My Look",
        status: "DRAFT",
        items: Object.entries(draft.items).map(([slot, garment_id]) => ({
          slot: slot.toUpperCase(),
          garment_id,
          position: 0,
        })),
      });
      const session = await step("session", "POST", "/vton-sessions", {
        member_id: draft.ownerId,
        source_screen: "OUTFIT_EDITOR",
        outfit_id: outfit.id,
      });
      await step("end", "POST", `/vton-sessions/${session.id}/end`, {
        expected_revision: session.revision,
        final_outfit_id: session.outfit_id,
        save_outfit: false,
      });
      // The server checks station/device access and confirmed slots; no client-simulated LED.
      let led: any;
      try {
        led = await step("led", "POST", "/integration/led-commands", {
          device_id: device,
          garment_ids: Object.values(draft.items),
        });
      } catch (error) {
        if ((error as { status?: number }).status !== 403) throw error;
        led = { anchor_ids: [], blocked: true };
      }
      return { outfitId: session.outfit_id, led };
    },
  );
}

export async function saveServerCard(outfitId: string) {
  return serverCommand(
    `card:${outfitId}`,
    { outfitId },
    async (step, check) => {
      const card = await step("draft", "POST", "/cards/drafts", {
        outfit_id: outfitId,
        template_id: "minimal-v1",
      });
      const job = await step("render", "POST", "/card-render-jobs", {
        card_id: card.id,
        output_format: "PNG",
        width: 1080,
        height: 1350,
      });
      await pollJob(`/jobs/${job.job_id}`, api(), check);
      return step("save", "POST", `/cards/${card.id}/save`, {
        visibility: "PRIVATE",
        reuse_outfit: false,
      });
    },
  );
}

export function confirmedTimestamp(date: string, time: string) {
  if (!isISODate(date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time))
    throw Error("직접 확인한 날짜와 시간을 입력하세요.");
  const value = `${date}T${time.length === 5 ? time + ":00" : time}+09:00`;
  if (!Number.isFinite(Date.parse(value)))
    throw Error("유효한 날짜를 입력하세요.");
  return value;
}
