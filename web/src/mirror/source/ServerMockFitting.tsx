import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import { api, currentMember, rawApi } from "./integrations/backendClient";
import { assetUrl, upload } from "../../api.js";
import {
  bindGarmentImage,
  invalidateImage,
  loadCachedImage,
} from "./imageBlobCache.js";
import {
  captureRequest,
  PocVtonFlow,
  VTON_SLOTS,
  type VtonResult,
} from "./pocVton";
import type { OutfitDraft } from "./core/types";

export function ServerMockFitting({
  draft,
  onResult,
}: {
  draft: OutfitDraft;
  onResult: (result: VtonResult) => void;
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
    flow = useRef<PocVtonFlow | null>(null),
    resultAssets = useRef(new Set<string>());
  const current = () =>
    mounted.current &&
    currentMember()?.id === owner &&
    app.repository === repository;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flow.current?.close();
      for (const id of resultAssets.current) {
        invalidateImage(id);
        bindGarmentImage(`vton:${id}`, null, undefined, null);
      }
    };
  }, []);
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
  const getFlow = () => {
    if (!flow.current)
      flow.current = new PocVtonFlow(
        rawApi(),
        owner,
        current,
        async (job, refresh) => {
          const a = job.result_asset;
          if (!a || !assetUrl(a.read_url))
            throw Error("Mock 결과 이미지가 없습니다.");
          const id = a.asset_id;
          let renewals = 0;
          resultAssets.current.add(id);
          const asAsset = (asset: any) => ({
            id: asset.asset_id,
            version: 1,
            url: assetUrl(asset.read_url),
            expiresAt: asset.expires_at,
          });
          bindGarmentImage(
            `vton:${id}`,
            asAsset(a),
            async () => {
              if (renewals++ >= 1)
                throw Error("결과 이미지 재발급 재시도 한도입니다.");
              const next = await refresh();
              if (next.status !== "SUCCEEDED")
                throw Error("결과가 더 이상 제공되지 않습니다.");
              return asAsset(next.result_asset);
            },
            null,
          );
          const load = async (asset: any) => {
            const url = await loadCachedImage(asAsset(asset));
            const image = new Image();
            image.src = url;
            await image.decode();
            return url;
          };
          try {
            return await load(a);
          } catch (error) {
            if (renewals >= 1) throw error;
            renewals++;
            invalidateImage(id);
            const next = await refresh();
            if (
              next.status !== "SUCCEEDED" ||
              next.result_asset?.asset_id !== id
            )
              throw Error("결과가 더 이상 제공되지 않습니다.");
            return load(next.result_asset);
          }
        },
      );
    return flow.current;
  };
  const execute = () =>
    run(async () => {
      const controller = getFlow();
      const request = captureRequest(
        draft,
        app.garments(),
        app.externalItems(),
        person,
        controller.context,
      );
      const result = await controller.execute(request);
      if (result && current()) {
        onResult(result);
        setOpen(false);
        setMessage("Mock 처리 완료 · 실제 시착 이미지가 아닙니다.");
      }
    });
  return (
    <div className="mc-server-fitting">
      <button type="button" onClick={() => setOpen(!open)}>
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
                  const client: any = rawApi(),
                    settings: any = await api().get("/settings");
                  if (!current()) return;
                  await client.request("/settings", {
                    method: "PUT",
                    body: { ...settings, image_upload_consent: true },
                  });
                  if (!current()) return;
                  const asset: any = await upload(client, file, "PERSON_VTON");
                  if (current()) {
                    setPerson(asset.asset_id);
                    setMessage("인물 사진 업로드 완료");
                  }
                });
              }}
            />
          </label>
          <div aria-label="시착 조합 선택">
            {VTON_SLOTS.map((slot) => (
              <label key={slot}>
                {slot.toUpperCase()}
                <select
                  aria-label={`${slot.toUpperCase()} 시착 의류`}
                  value={
                    draft.externalItems?.[slot]
                      ? `LIKED:${draft.externalItems[slot]!.externalItemId}`
                      : draft.items[slot]
                        ? `OWNED:${draft.items[slot]}`
                        : ""
                  }
                  onChange={(e) => {
                    try {
                      const [kind, id] = e.target.value.split(":");
                      if (!kind) app.removeOutfitItem(slot);
                      else if (kind === "OWNED") app.setOutfitItem(slot, id);
                      else app.setExternalOutfitItem(slot, id);
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  <option value="">선택 안 함</option>
                  <optgroup label="내 옷장">
                    {app
                      .garments()
                      .filter((g) => g.category === slot)
                      .map((g) => (
                        <option key={`OWNED:${g.id}`} value={`OWNED:${g.id}`}>
                          {g.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="관심 의류">
                    {app
                      .externalItems()
                      .filter((i) => i.category === slot)
                      .map((i) => (
                        <option key={`LIKED:${i.id}`} value={`LIKED:${i.id}`}>
                          {i.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !person || !consent}
            onClick={() => void execute()}
          >
            {busy ? "작업 확인 중" : "Mock VTON 실행"}
          </button>
          <small>
            생성 중에도 조합을 바꿀 수 있습니다. 결과는 실행 순간의 조합에
            연결됩니다. 유료 호출 없음.
          </small>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
