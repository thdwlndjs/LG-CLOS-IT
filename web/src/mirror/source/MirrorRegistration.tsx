import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import type { Asset, Category } from "./core/types";
import { HttpRemoteBackend, api } from "./integrations/backendClient";
import { MirrorPhoto } from "./MirrorGarmentGrid";
const types: { value: Category; label: string }[] = [
  { value: "dress", label: "원피스" },
  { value: "top", label: "상의" },
  { value: "bottom", label: "하의" },
  { value: "outer", label: "아우터" },
  { value: "shoes", label: "신발" },
  { value: "bag", label: "가방" },
  { value: "hat", label: "모자" },
  { value: "accessory", label: "액세서리" },
];
export function MirrorRegistration({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    owner = state.activeProfileId,
    repository = app.repository,
    draft = app.registrationDraft();
  const [locations, setLocations] = useState<any[]>([]);
  useEffect(() => {
    void api()
      .get("/integration/devices")
      .then(
        (r: any) =>
          r.items[0] &&
          api().get(`/integration/devices/${r.items[0].id}/locations`),
      )
      .then((r: any) => setLocations(r?.items || []))
      .catch(() => {});
  }, []);
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false);
  const generation = useRef(0),
    saving = useRef(false);
  useEffect(() => {
    app.beginRegistration();
    return () => {
      generation.current++;
    };
  }, []);
  const isCurrent = (token: number) =>
    generation.current === token &&
    app.getState().activeProfileId === owner &&
    app.repository === repository;
  const upload = async (file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage(
        "PNG·JPEG·WebP 10MB 이하를 선택해 주세요. 이전 입력은 유지해요.",
      );
      return;
    }
    const token = ++generation.current,
      snapshot = app.registrationDraft();
    const url = URL.createObjectURL(file);
    setBusy(true);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        !isCurrent(token) ||
        app.registrationDraft()?.revision !== snapshot?.revision
      ) {
        URL.revokeObjectURL(url);
        return;
      }
      let asset: Asset;
      if (app.connection.kind === "supabase") {
        if (!consent) throw new Error("Image upload consent required");
        const settings: any = await api().get("/settings");
        await api().send("PUT", "/settings", {
          ...settings,
          image_upload_consent: true,
        });
        asset = await new HttpRemoteBackend().upload(file, "garment");
        URL.revokeObjectURL(url);
      } else
        asset = {
          id: `upload-${crypto.randomUUID()}`,
          version: 1,
          source: "upload",
          url,
        };
      if (
        !isCurrent(token) ||
        app.registrationDraft()?.revision !== snapshot?.revision
      ) {
        if (asset.source === "upload") URL.revokeObjectURL(url);
        return;
      }
      app.replaceRegistrationPhoto(asset);
      setMessage("사진을 선택했어요. 옷 등록은 마지막 저장에서 확정해요.");
    } catch (e) {
      URL.revokeObjectURL(url);
      if (isCurrent(token))
        setMessage(
          e instanceof Error
            ? e.message
            : "사진을 읽거나 보관하지 못했어요. 이전 사진과 입력은 유지해요.",
        );
    } finally {
      if (isCurrent(token)) setBusy(false);
    }
  };
  const analyze = async () => {
    const token = ++generation.current;
    setBusy(true);
    setMessage("분석 제안을 확인하고 있어요.");
    try {
      const result = await app.analyzeRegistration();
      if (isCurrent(token))
        setMessage(
          result.status === "success"
            ? "분석 제안이에요. 직접 입력한 값은 유지했어요."
            : result.message,
        );
    } catch (e) {
      if (isCurrent(token))
        setMessage("분석을 확인하지 못했어요. 수동 입력으로 계속할 수 있어요.");
    } finally {
      if (isCurrent(token)) setBusy(false);
    }
  };
  const save = async () => {
    if (saving.current || !draft) return;
    saving.current = true;
    const token = ++generation.current;
    setBusy(true);
    try {
      const result = await app.saveGarment(
        `garment:${draft.draftId}:${draft.revision}`,
      );
      if (isCurrent(token))
        setMessage(
          result.replayed
            ? "이미 저장한 의류예요."
            : `의류를 ${app.connection.kind === "supabase" ? "내 계정에" : "이 브라우저에"} 저장했어요.`,
        );
    } catch (e) {
      if (isCurrent(token))
        setMessage(
          e instanceof Error ? e.message : "저장을 확인하지 못했어요.",
        );
    } finally {
      saving.current = false;
      if (isCurrent(token)) setBusy(false);
    }
  };
  if (!draft) return null;
  const savedRevision = app
    .receipts()
    .some(
      (r) =>
        r.operation === "saveGarment" &&
        r.draftId === draft.draftId &&
        r.revision === draft.revision,
    );
  return (
    <section className="mx-registration mx-work" aria-label="의류 등록">
      <div className="mg-heading">
        <h1>사진 등록</h1>
        <button onClick={onClose} aria-label="등록 닫기">
          닫기
        </button>
      </div>
      <p className="mg-step">
        {step + 1} / 4 · {["사진", "기본 정보", "추가 정보", "확인·저장"][step]}
      </p>
      {step === 0 && (
        <div className="mg-register-page">
          <div className="mg-register-photo">
            <MirrorPhoto asset={draft.asset} name="등록 사진" />
          </div>
          <label className="mg-file-label">
            사진 선택
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || !consent}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {app.connection.kind === "supabase" && (
            <label className="mg-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              이미지 비공개 업로드 동의
            </label>
          )}
          <button
            disabled={busy || !draft.asset}
            onClick={() => void analyze()}
          >
            사진 분석 제안
          </button>
          <small>분석 없이 직접 입력할 수 있어요.</small>
        </div>
      )}
      {step === 1 && (
        <div className="mg-register-page">
          <label>
            옷 이름
            <input
              maxLength={100}
              value={draft.name}
              onChange={(e) => app.editRegistration({ name: e.target.value })}
            />
          </label>
          <label>
            종류
            <select
              aria-label="종류"
              value={draft.category}
              onChange={(e) =>
                app.editRegistration({ category: e.target.value as Category })
              }
            >
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            색상 · 필수
            <input
              value={draft.color}
              onChange={(e) => app.editRegistration({ color: e.target.value })}
            />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="mg-register-page">
          {(["material", "size", "location"] as const).map((field, i) => (
            <label key={field}>
              {["소재", "사이즈", "확인한 보관 위치"][i]} · 선택
              {field === "location" ? (
                <select
                  value={draft.location}
                  onChange={(e) =>
                    app.editRegistration({ location: e.target.value })
                  }
                >
                  <option value="">Unknown</option>
                  {locations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  disabled={field === "size"}
                  value={field === "size" ? "" : draft[field]}
                  onChange={(e) =>
                    app.editRegistration({ [field]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
          <small>
            확인한 정보만 입력해 주세요. 위치 미확인은 LED를 켜지 않아요.
          </small>
        </div>
      )}
      {step === 3 && (
        <div className="mg-register-page">
          <strong>{draft.name || "이름 미입력"}</strong>
          <p>
            {types.find((t) => t.value === draft.category)?.label} ·{" "}
            {draft.color || "색상 미입력"}
          </p>
          <label>
            직접 확인한 관리 정보 · 선택
            <textarea
              rows={3}
              value={draft.careNotes}
              onChange={(e) =>
                app.editRegistration({ careNotes: e.target.value })
              }
            />
          </label>
          <button
            className="mx-primary"
            disabled={busy || !draft.color.trim()}
            onClick={() => void save()}
          >
            {busy ? "저장 확인 중" : "의류 저장"}
          </button>
          {draft.savedGarmentId && <button onClick={onClose}>목록으로</button>}
          {savedRevision && (
            <button
              onClick={() => {
                app.discardRegistration();
                app.beginRegistration();
                setStep(0);
                setMessage("");
                setConsent(false);
              }}
            >
              다른 옷 등록
            </button>
          )}
        </div>
      )}
      <div className="mg-step-nav">
        <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          이전
        </button>
        <button disabled={step === 3} onClick={() => setStep((s) => s + 1)}>
          다음
        </button>
      </div>
      {message && (
        <p className="mg-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
