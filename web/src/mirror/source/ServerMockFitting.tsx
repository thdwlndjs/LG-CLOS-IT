import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import { api, currentMember, rawApi } from "./integrations/backendClient";
import { assetUrl, upload } from "../../api.js";
import { pollJob } from "./serverActions";
import { serverCommand } from "./secondHandoffActions";
import type { OutfitDraft } from "./core/types";
import { completeOutfit, hasExternalItems } from "./core/externalOutfits";

export function ServerMockFitting({
  draft,
  onResult,
}: {
  draft: OutfitDraft;
  onResult: (url: string, label?: string) => void;
}) {
  const owner = draft.ownerId,
    repository = app.repository;
  const [open, setOpen] = useState(false),
    [consent, setConsent] = useState(false),
    [person, setPerson] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const mounted = useRef(true),
    pending = useRef(false),
    intent = useRef(crypto.randomUUID());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    currentMember()?.id === owner &&
    app.repository === repository &&
    app.outfitDraft()?.draftId === draft.draftId &&
    app.outfitDraft()?.revision === draft.revision;
  const run = async (fn: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (current()) setMessage((e as Error).message);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const execute = () =>
    run(async () => {
      if (!person || !completeOutfit(draft))
        throw Error("동의된 인물 사진과 완성된 조합을 선택하세요.");
      const external = Object.values(draft.externalItems || {});
      if (
        external.length &&
        (external.length !== 1 ||
          !app
            .externalItems()
            .some((item) => item.id === external[0].externalItemId))
      )
        throw Error("현재 LIKED 상품 한 개를 선택하세요.");
      const result: any = await serverCommand(
        `mock-fitting:${intent.current}`,
        { person, draft },
        async (step, check) => {
          if (external.length) {
            const job = await step(
              "liked-job",
              "POST",
              "/integration/shopping/liked/vton-jobs",
              {
                external_item_id: external[0].externalItemId,
                person_asset_id: person,
              },
            );
            return pollJob(`/jobs/${job.job_id}`, api(), check);
          }
          const outfit = await step("outfit", "POST", "/outfits", {
            title: draft.name,
            status: "DRAFT",
            items: Object.entries(draft.items).map(([slot, garment_id]) => ({
              slot: slot.toUpperCase(),
              garment_id,
              position: 0,
            })),
          });
          if (!outfit.try_on_ready)
            throw Error(
              "구성 의류의 상태와 동의된 이미지를 먼저 확인하세요. Mock도 검증을 우회하지 않습니다.",
            );
          const session = await step("session", "POST", "/vton-sessions", {
            member_id: owner,
            source_screen: "OUTFIT_EDITOR",
            outfit_id: outfit.id,
            person_asset_id: person,
          });
          const job = await step("job", "POST", "/vton-jobs", {
            session_id: session.id,
            expected_revision: session.revision,
            person_asset_id: person,
            outfit_id: session.outfit_id,
            provider: "MOCK",
          });
          return pollJob(`/jobs/${job.job_id}`, api(), check);
        },
      );
      if (!current()) return;
      const url = assetUrl(result.result_asset?.read_url);
      if (!url) throw Error("Mock 결과 이미지가 없습니다.");
      const label = external.length
        ? "LIKED 단품 Mock 결과 · 보유 옷 조합 전체를 반영한 실제 피팅 아님"
        : "Mock VTON 결과 · 실제 피팅 아님";
      onResult(url, label);
      setOpen(false);
      setMessage(label);
    });
  return (
    <div className="mc-server-fitting">
      <button type="button" onClick={() => setOpen(!open)} disabled={busy}>
        Mock 피팅
      </button>
      {open && (
        <div role="group" aria-label="Mock 피팅 입력">
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            인물 사진 비공개 업로드에 동의합니다.
          </label>
          <label>
            인물 사진
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || !consent}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void run(async () => {
                  const settings: any = await api().get("/settings");
                  if (!current()) return;
                  await api().send("PUT", "/settings", {
                    ...settings,
                    image_upload_consent: true,
                  });
                  if (!current()) return;
                  const asset: any = await upload(
                    rawApi(),
                    file,
                    "PERSON_VTON",
                  );
                  if (current()) {
                    setPerson(asset.asset_id);
                    intent.current = crypto.randomUUID();
                    setMessage("인물 사진 업로드 완료");
                  }
                });
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !person || !consent}
            onClick={() => void execute()}
          >
            {busy ? "작업 확인 중" : "Mock VTON 실행"}
          </button>
          <small>
            선택·조회만으로 호출하지 않습니다. 유료 API는 사용하지 않습니다.
          </small>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
