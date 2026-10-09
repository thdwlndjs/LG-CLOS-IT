import { useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import {
  api,
  currentDevice,
  currentMember,
  rawApi,
} from "./integrations/backendClient";
import { assetUrl, upload } from "../../api.js";

export function IntegrationActions() {
  useSyncExternalStore(app.subscribe, app.getState);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [person, setPerson] = useState(""),
    [consent, setConsent] = useState(false),
    [image, setImage] = useState(""),
    [share, setShare] = useState(""),
    [shopping, setShopping] = useState<any[]>([]),
    [outfit, setOutfit] = useState(""),
    [session, setSession] = useState<any>(null);
  const [garmentId, setGarmentId] = useState(""),
    [editName, setEditName] = useState(""),
    [editColor, setEditColor] = useState(""),
    [locations, setLocations] = useState<any[]>([]),
    [locationId, setLocationId] = useState("");
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("처리 중");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const poll = async (path: string) => {
    for (let i = 0; i < 120; i++) {
      const row: any = await api().get(path);
      if (["SUCCEEDED", "READY"].includes(row.status)) return row;
      if (["FAILED", "TIMED_OUT", "CANCELLED"].includes(row.status))
        throw new Error(
          `작업 실패: ${row.error?.code || row.error_code || row.status}`,
        );
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("작업 시간 초과");
  };
  const prepare = async () => {
    const draft = app.outfitDraft();
    if (!draft || Object.keys(draft.externalItems || {}).length)
      throw new Error("보유 의류 조합을 선택하세요.");
    const o: any = await api().send("POST", "/outfits", {
      title: draft.name || "My Look",
      status: "DRAFT",
      items: Object.entries(draft.items).map(([slot, id]) => ({
        slot: slot.toUpperCase(),
        garment_id: id,
        position: 0,
      })),
    });
    const s: any = await api().send("POST", "/vton-sessions", {
      member_id: currentMember().id,
      source_screen: "OUTFIT_EDITOR",
      outfit_id: o.id,
      person_asset_id: person || null,
    });
    setSession(s);
    setOutfit(s.outfit_id);
    return { o: { ...o, id: s.outfit_id }, s };
  };
  return (
    <section className="backend-panel" aria-label="통합 기능">
      <h3>연결된 기능 · Mock</h3>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        이미지 비공개 업로드 동의
      </label>
      <label>
        인물 사진
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || !consent}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void run(async () => {
                const settings: any = await api().get("/settings");
                await api().send("PUT", "/settings", {
                  ...settings,
                  image_upload_consent: true,
                });
                const a: any = await upload(rawApi(), file, "PERSON_VTON");
                setPerson(a.asset_id);
                setMessage("인물 사진 업로드 완료");
              });
          }}
        />
      </label>
      <button
        disabled={busy || !person}
        onClick={() =>
          void run(async () => {
            const { o, s } = await prepare();
            if (!o.try_on_ready)
              throw new Error(
                "모든 구성 의류의 상태와 동의된 이미지를 확인해야 피팅할 수 있습니다.",
              );
            const j: any = await api().send("POST", "/vton-jobs", {
              session_id: s.id,
              expected_revision: s.revision,
              person_asset_id: person,
              outfit_id: o.id,
              provider: "MOCK",
            });
            const result = await poll(`/jobs/${j.job_id}`);
            setImage(assetUrl(result.result_asset?.read_url) || "");
            setMessage("Mock VTON 성공 · 실제 피팅 아님");
          })
        }
      >
        Mock VTON 실행
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const prepared = session
              ? { o: { id: outfit }, s: session }
              : await prepare();
            await api().send("POST", `/vton-sessions/${prepared.s.id}/end`, {
              expected_revision: prepared.s.revision,
              final_outfit_id: prepared.o.id,
              save_outfit: false,
            });
            const ids = Object.values(app.outfitDraft()?.items || {});
            await api().send("POST", "/integration/led-commands", {
              device_id: currentDevice(),
              garment_ids: ids,
            });
            setMessage("코디 확정 · 착용 예정/실제 착용 기록 없음");
            setSession(null);
          })
        }
      >
        코디 확정 · LED
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const saved = await app.saveOutfit(
              `card:${app.outfitDraft()?.draftId}:${app.outfitDraft()?.revision}`,
            );
            const c: any = await api().send("POST", "/cards/drafts", {
              outfit_id: saved.entity.id,
              template_id: "minimal-v1",
            });
            const j: any = await api().send("POST", "/card-render-jobs", {
              card_id: c.id,
              output_format: "PNG",
              width: 1080,
              height: 1350,
            });
            await poll(`/jobs/${j.job_id}`);
            const result: any = await api().send(
              "POST",
              `/cards/${c.id}/save`,
              {
                title: saved.entity.name,
                visibility: "SHAREABLE",
                reuse_outfit: false,
              },
            );
            setImage(assetUrl(result.image_asset?.read_url) || "");
            setShare(assetUrl(result.share_url) || "");
            setMessage("코디카드 이미지 생성·저장 완료");
          })
        }
      >
        코디카드 생성·저장·공유
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r: any = await api().get("/integration/shopping/purchases");
            setShopping(r.items);
            setMessage("Synthetic Mock 구매 내역");
          })
        }
      >
        구매 내역 전체 조회
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r: any = await api().send(
              "POST",
              "/integration/shopping/purchases/bulk-import",
              { device_id: currentDevice() },
            );
            setShopping(r.results);
            await app.reloadRemote();
            const duplicates = r.results.filter(
              (row: any) => row.reason === "ALREADY_IMPORTED",
            ).length;
            setMessage(
              `등록 ${r.counts.registered}건 · 중복 ${duplicates}건 · 검토 ${r.counts.needs_review}건 · 제외 ${r.counts.skipped}건`,
            );
          })
        }
      >
        구매 내역 일괄 등록
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r: any = await api().get("/integration/shopping/liked");
            setShopping(r.items);
            setMessage("LIKED · 보유 의류 아님");
          })
        }
      >
        LIKED 조회
      </button>
      {shopping.map((row) => (
        <div key={`${row.id || row.item_id}:${row.unit || 0}`}>
          <small>
            {row.name || row.item_id} · {row.status || "LIKED"}{" "}
            {row.reason || ""}
          </small>
          {row.id?.startsWith("mock-liked") && (
            <button
              disabled={busy || !person}
              onClick={() =>
                void run(async () => {
                  const j: any = await api().send(
                    "POST",
                    "/integration/shopping/liked/vton-jobs",
                    { external_item_id: row.id, person_asset_id: person },
                  );
                  const r = await poll(
                    `/integration/shopping/liked/vton-jobs/${j.job_id}`,
                  );
                  setImage(assetUrl(r.result_asset?.read_url) || "");
                  setMessage(
                    "LIKED Mock VTON 성공 · 의류/코디/착용 기록 미생성",
                  );
                })
              }
            >
              이 상품 Mock VTON
            </button>
          )}
        </div>
      ))}
      <label>
        관리할 의류
        <select
          aria-label="관리할 의류"
          value={garmentId}
          onChange={(e) => {
            setGarmentId(e.target.value);
            const g = app.garments().find((g) => g.id === e.target.value);
            setEditName(g?.name || "");
            setEditColor(g?.color || "");
          }}
        >
          <option value="">의류 선택</option>
          {app.garments().map((g) => (
            <option value={g.id} key={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        이름 · 선택
        <input value={editName} onChange={(e) => setEditName(e.target.value)} />
      </label>
      <label>
        색상
        <input
          value={editColor}
          onChange={(e) => setEditColor(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !garmentId || !editColor.trim()}
        onClick={() =>
          void run(async () => {
            const g: any = await api().get(`/garments/${garmentId}`);
            await api().send(
              "PATCH",
              `/garments/${garmentId}`,
              {
                owner_id: g.owner_id,
                device_id: g.device_id,
                name: editName.trim() || null,
                category: g.category,
                color: editColor.trim(),
              },
              { version: g.version },
            );
            await app.reloadRemote();
            setMessage("의류 수정 완료");
          })
        }
      >
        의류 정보 수정
      </button>
      <button
        disabled={busy || !garmentId}
        onClick={() =>
          void run(async () => {
            const r: any = await api().get(`/garments/${garmentId}/care-guide`);
            setMessage([...r.instructions, ...r.warnings].join("\n"));
          })
        }
      >
        특별 관리 가이드
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r: any = await api().get(
              `/integration/devices/${currentDevice()}/locations`,
            );
            setLocations(r.items);
            setMessage("등록된 보관 위치만 선택합니다.");
          })
        }
      >
        보관 위치 조회
      </button>
      <label>
        확인한 보관 위치
        <select
          aria-label="확인한 보관 위치"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">미확인</option>
          {locations.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !garmentId || !locationId}
        onClick={() =>
          void run(async () => {
            const g: any = await api().get(`/garments/${garmentId}`);
            await api().send(
              "PATCH",
              `/garments/${garmentId}`,
              {
                owner_id: g.owner_id,
                category: g.category,
                color: g.color,
                location_id: locationId,
              },
              { version: g.version },
            );
            await app.reloadRemote();
            setMessage("명시적으로 확인한 위치 저장 완료");
          })
        }
      >
        확인한 위치 저장
      </button>
      <button
        disabled={busy || !garmentId}
        onClick={() =>
          void run(async () => {
            await api().send("POST", "/integration/led-commands", {
              device_id: currentDevice(),
              garment_ids: [garmentId],
            });
            setMessage("확인된 슬롯 LED 점등 · 설정 시간 후 자동 소등");
          })
        }
      >
        이 의류 위치 LED
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const m = currentMember();
            const j: any = await api().send(
              "POST",
              "/storage-optimization-jobs",
              {
                household_id: m.household_id,
                member_id: m.id,
                mode: "WEAR_PATTERN",
                dry_run: true,
                season: "ALL",
                analysis_window_days: 90,
                garment_ids: [],
              },
            );
            const r = await poll(`/jobs/${j.job_id}`);
            setMessage(
              `보관·회수 제안 ${r.storage_result?.proposed_items?.length || 0}건 · 검토 필요 ${r.storage_result?.blocked?.length || 0}건 · 이동은 실행하지 않았습니다. ${(r.storage_result?.diagnostics || []).join(" ")} ${(r.storage_result?.blocked || []).flatMap((b: any) => b.reasons).join(" ")}`,
            );
          })
        }
      >
        보관·회수 추천
      </button>
      {image && (
        <img
          src={image}
          alt="서버 생성 이미지 결과"
          style={{ width: "100%" }}
        />
      )}
      {share && (
        <a href={share} target="_blank" rel="noreferrer">
          코디카드 공유 이미지 열기
        </a>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
