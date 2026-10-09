import { useEffect, useRef, useState } from "react";
import type { DemoApp } from "./core/app";
import type { Asset } from "./core/types";
import type { AvailabilityConfirmation } from "./outfitReview";
import { HttpRemoteBackend } from "./integrations/backendClient";
import { labelEvidenceAssetId, type ScopedLabelUpload } from "./careEvidence";

const client = new HttpRemoteBackend();
type StyleObservation = {
  kind: "style_observation";
  colors: string[];
  silhouettes: string[];
  layers: string[];
  style_keywords: string[];
  observed_items: { slot: string | null; description: string }[];
  unknown_fields: string[];
};
type PhotoDecision = {
  analyzable: boolean;
  needsManualReview: boolean;
  visibleProbability: number | null;
  targetCount: "one" | "many" | "none_or_uncertain" | null;
  visibilityScore: number | null;
  refused: boolean;
};

export function PhotoSuitability({ app }: { app: DemoApp }) {
  const [result, setResult] = useState<PhotoDecision | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  const draft = app.registrationDraft();
  const fingerprint = JSON.stringify(draft);
  useEffect(() => {
    generation.current++;
    setResult(null);
    setMessage("");
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [fingerprint]);
  const check = async () => {
    if (!draft?.asset) return;
    const token = ++generation.current,
      owner = app.getState().activeProfileId,
      expected = fingerprint;
    const current = () =>
      token === generation.current &&
      owner === app.getState().activeProfileId &&
      app.connection.kind === "supabase" &&
      expected === JSON.stringify(app.registrationDraft());
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const response = await client.request<{
        result?: PhotoDecision;
        message?: string;
      }>(`/api/registrations/${draft.draftId}/evaluate-photo`, "POST", {
        draft: structuredClone(draft),
        intent_key: crypto.randomUUID(),
        mode: app.connection.mode,
      });
      if (!current()) return;
      setResult(response.result ?? null);
      setMessage(
        response.result
          ? "사진 적합성 판단만 받았어요. 의류 정보와 저장 기록은 바꾸지 않았어요."
          : (response.message ??
              "이 사진에 일치하는 적합성 판단 결과가 없어요."),
      );
    } catch (e) {
      if (current())
        setMessage(
          e instanceof Error ? e.message : "사진 적합성을 확인하지 못했어요.",
        );
    } finally {
      if (current()) setBusy(false);
    }
  };
  if (app.connection.kind !== "supabase") return null;
  return (
    <div className="photo-suitability">
      <button
        className="button"
        disabled={busy || !draft?.asset}
        onClick={() => void check()}
      >
        {busy ? "사진 판단 중…" : "사진 적합성 확인"}
      </button>
      {result && (
        <div className="info-block">
          <p>
            {result.refused
              ? "판단 응답 거절 · 직접 확인 필요"
              : result.needsManualReview || !result.analyzable
                ? "수동 검토 필요"
                : "사진 분석 가능 제안 · 등록 확정 아님"}
          </p>
          <small>
            의류 가시성 확률:{" "}
            {result.visibleProbability === null
              ? "미확인"
              : `${Math.round(result.visibleProbability * 100)}%`}{" "}
            · 대상 수:{" "}
            {result.targetCount === "one"
              ? "1개"
              : result.targetCount === "many"
                ? "여러 개"
                : "미확인"}{" "}
            · 가시성 점수:{" "}
            {result.visibilityScore === null
              ? "미확인"
              : `${result.visibilityScore} / 2`}
          </small>
        </div>
      )}
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
    </div>
  );
}

export function StyleReferenceInput({
  app,
  availabilityConfirmations,
}: {
  app: DemoApp;
  availabilityConfirmations?: AvailabilityConfirmation[];
}) {
  const [asset, setAsset] = useState<Asset | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [observation, setObservation] = useState<StyleObservation | null>(null);
  const [allowOpenAI, setAllowOpenAI] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    const token = ++generation.current,
      owner = app.getState().activeProfileId;
    const current = () =>
      token === generation.current &&
      app.connection.kind === "supabase" &&
      app.getState().activeProfileId === owner;
    setBusy(true);
    setMessage("");
    try {
      await action(current);
    } catch (e) {
      if (current())
        setMessage(
          e instanceof Error ? e.message : "참고 자료를 확인하지 못했어요.",
        );
    } finally {
      if (current()) setBusy(false);
    }
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage("PNG·JPEG·WebP, 10MB 이하 사진을 선택해 주세요.");
      return;
    }
    void run(async (current) => {
      const result = await client.upload(
        file,
        "style_reference",
        allowOpenAI ? ["openai"] : [],
      );
      if (current()) {
        setAsset(result);
        setObservation(null);
        setMessage(
          "참고 사진을 비공개 저장소에 보관했어요. 외부 AI로 전송하지 않았어요.",
        );
      }
    });
  };
  return (
    <details className="reference-input">
      <summary>외부 참고를 내 옷으로</summary>
      <p>
        본인이 사용할 수 있는 참고 사진을 직접 선택해요. 사이트 방문만으로
        사진을 가져오지 않아요.
      </p>
      {app.connection.kind !== "supabase" ? (
        <p className="subtle">
          마이에서 본인 계정을 연결한 뒤 사진을 보관할 수 있어요.
        </p>
      ) : (
        <>
          <label className="consent-choice">
            <input
              type="checkbox"
              checked={allowOpenAI}
              onChange={(e) => setAllowOpenAI(e.target.checked)}
            />
            이 참고 사진의 OpenAI 전송에 동의해요. 비용 승인은 별도예요.
          </label>
          <p className="subtle">
            체크만으로 전송하지 않아요. 이미 보관한 사진의 허용 범위는 바뀌지
            않으므로 변경했다면 다시 업로드해 주세요.
          </p>
          <label>
            스타일 참고 사진
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
          {asset && (
            <img
              className="style-reference-photo"
              src={asset.url ?? undefined}
              alt="직접 선택한 스타일 참고"
            />
          )}
          <div className="actions">
            <button
              className="button"
              disabled={busy || !asset}
              onClick={() =>
                void run(async (current) => {
                  const result = await client.request<{
                    processing_status: string;
                    mode: string;
                    result?: StyleObservation;
                    message?: string;
                  }>("/api/styles/analyze-reference", "POST", {
                    reference_asset_id: asset!.id,
                    intent_key: crypto.randomUUID(),
                    mode: app.connection.mode,
                  });
                  if (!current()) return;
                  setObservation(
                    result.result?.kind === "style_observation"
                      ? result.result
                      : null,
                  );
                  setMessage(
                    result.result?.kind === "style_observation"
                      ? "참고 사진의 특징을 받았어요. 내 옷 조합이나 저장 기록은 아직 바꾸지 않았어요."
                      : (result.message ??
                          "이 참고 사진과 일치하는 분석 결과가 없어요."),
                  );
                })
              }
            >
              참고 사진 특징 확인
            </button>
            <button
              className="button"
              disabled={busy || !asset}
              onClick={() =>
                void run(async (current) => {
                  const result = await app.adaptStyleToWardrobe(
                    asset!.id,
                    undefined,
                    availabilityConfirmations,
                  );
                  if (current())
                    setMessage(
                      result.status === "success"
                        ? "보유한 옷으로 구성한 제안을 초안에 적용했어요. 코디 저장은 별도예요."
                        : result.message,
                    );
                })
              }
            >
              {busy ? "참고 확인 중…" : "참고를 내 옷으로 구성하기"}
            </button>
          </div>
          {observation && (
            <div className="info-block">
              <p>사진에서 관찰한 특징</p>
              <small>
                {[
                  ...observation.colors,
                  ...observation.silhouettes,
                  ...observation.layers,
                  ...observation.style_keywords,
                ].join(" · ") || "확인된 특징 없음"}
              </small>
              {observation.observed_items.map((item, i) => (
                <p key={i}>{item.description}</p>
              ))}
              {observation.unknown_fields.length > 0 && (
                <p>미확인: {observation.unknown_fields.join(" · ")}</p>
              )}
            </div>
          )}
          <p className="subtle">
            외부 AI 전송 허용은 기본 꺼짐이며 실제 실행 승인은 보류 중이에요.
            입력에 일치하는 준비 결과가 없으면 미연동 상태를 안내해요.
          </p>
        </>
      )}
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
    </details>
  );
}

export function CareEvidenceInput({
  app,
  garmentId,
  onSaved,
}: {
  app: DemoApp;
  garmentId: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<
      "user_observation" | "label" | "official_guidance"
    >("user_observation"),
    [original, setOriginal] = useState(""),
    [source, setSource] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [labelUpload, setLabelUpload] = useState<ScopedLabelUpload | null>(
      null,
    ),
    [suggestion, setSuggestion] = useState<{
      text: string;
      jobId?: string;
    } | null>(null),
    [copiedSuggestion, setCopiedSuggestion] = useState(false),
    [checkedOriginal, setCheckedOriginal] = useState(false);
  const activeOwner = app.getState().activeProfileId,
    context = useRef({ ownerId: activeOwner, garmentId, generation: 0 });
  if (
    context.current.ownerId !== activeOwner ||
    context.current.garmentId !== garmentId
  )
    context.current = {
      ownerId: activeOwner,
      garmentId,
      generation: context.current.generation + 1,
    };
  const labelAsset =
    labelUpload?.ownerId === activeOwner &&
    labelUpload.garmentId === garmentId &&
    labelUpload.contextGeneration === context.current.generation
      ? labelUpload.asset
      : null;
  const [allowOpenAI, setAllowOpenAI] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    generation.current++;
    setLabelUpload(null);
    setSuggestion(null);
    setOriginal("");
    setSource("");
    setCopiedSuggestion(false);
    setCheckedOriginal(false);
    setBusy(false);
    setMessage("");
  }, [activeOwner, garmentId]);
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    const token = ++generation.current,
      owner = app.getState().activeProfileId,
      scopeGeneration = context.current.generation;
    const current = () =>
      token === generation.current &&
      scopeGeneration === context.current.generation &&
      context.current.garmentId === garmentId &&
      app.connection.kind === "supabase" &&
      app.getState().activeProfileId === owner;
    setBusy(true);
    setMessage("");
    try {
      await action(current);
    } catch (e) {
      if (current())
        setMessage(
          e instanceof Error
            ? e.message
            : "관리 근거를 처리하지 못했어요. 입력은 유지했어요.",
        );
    } finally {
      if (current()) setBusy(false);
    }
  };
  const save = () =>
    run(async (current) => {
      if (copiedSuggestion && !checkedOriginal)
        throw new Error("추출 제안을 실제 라벨과 대조해 확인해 주세요.");
      const assetId = labelEvidenceAssetId(
        kind,
        app.getState().activeProfileId,
        garmentId,
        context.current.generation,
        labelUpload,
      );
      await client.request("/api/evidence-items", "POST", {
        garment_id: garmentId,
        ...(assetId ? { asset_id: assetId } : {}),
        evidence_kind: kind,
        original_text: original.trim(),
        observed_at: new Date().toISOString(),
        ...(source.trim() ? { source_ref: source.trim() } : {}),
      });
      if (current()) {
        setOriginal("");
        setSource("");
        setCopiedSuggestion(false);
        setCheckedOriginal(false);
        setMessage(
          "직접 확인한 원문을 저장했어요. 케어 안내를 다시 확인할 수 있어요. 관리 완료 기록은 만들지 않았어요.",
        );
        onSaved();
      }
    });
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage("PNG·JPEG·WebP, 10MB 이하 라벨 사진을 선택해 주세요.");
      return;
    }
    void run(async (current) => {
      const asset = await client.upload(
        file,
        "label",
        allowOpenAI ? ["openai"] : [],
      );
      if (current()) {
        setLabelUpload({
          ownerId: context.current.ownerId,
          garmentId,
          contextGeneration: context.current.generation,
          asset,
        });
        setSuggestion(null);
        setMessage(
          "라벨 사진을 따로 보관했어요. 의류 사진과 관리 원문은 바꾸지 않았어요.",
        );
      }
    });
  };
  return (
    <details className="reference-input">
      <summary>확인한 관리 근거 추가</summary>
      <p>
        직접 본 라벨, 공식 안내 또는 관찰 내용을 원문대로 입력해요. AI의
        추정이나 안내는 확인된 원문으로 바꾸지 않아요.
      </p>
      {app.connection.kind !== "supabase" ? (
        <p className="subtle">
          마이에서 본인 계정을 연결한 뒤 관리 근거를 저장할 수 있어요.
        </p>
      ) : (
        <>
          <details>
            <summary>라벨 사진에서 읽기 제안 받기</summary>
            <label className="consent-choice">
              <input
                type="checkbox"
                checked={allowOpenAI}
                onChange={(e) => setAllowOpenAI(e.target.checked)}
              />
              이 라벨 사진의 OpenAI 전송에 동의해요. 비용 승인은 별도예요.
            </label>
            <p className="subtle">
              체크만으로 전송하지 않아요. 변경한 허용 범위는 새 업로드에만
              적용해요.
            </p>
            <label>
              별도 관리 라벨 사진
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            <button
              className="button"
              disabled={busy || !labelAsset}
              onClick={() =>
                void run(async (current) => {
                  const result = await client.request<{
                    job_id?: string;
                    result?: { label_text: string | null };
                    message?: string;
                  }>("/api/labels/analyze", "POST", {
                    reference_asset_id: labelAsset!.id,
                    intent_key: crypto.randomUUID(),
                    mode: app.connection.mode,
                  });
                  if (!current()) return;
                  setSuggestion(
                    result.result?.label_text
                      ? { text: result.result.label_text, jobId: result.job_id }
                      : null,
                  );
                  setMessage(
                    result.result?.label_text
                      ? "읽기 제안이에요. 아직 확인된 관리 근거로 저장하지 않았어요."
                      : (result.message ??
                          "이 라벨에서 읽을 수 있는 준비 결과가 없어요."),
                  );
                })
              }
            >
              라벨 읽기 제안 확인
            </button>
            <p className="subtle">
              공급자 전송 허용은 기본 꺼짐이에요. 실제 라벨 원본과 실행 승인이
              없으면 정상 분석 완료로 표시하지 않아요.
            </p>
            {suggestion && (
              <div className="info-block">
                <label>
                  미확인 라벨 추출 제안
                  <textarea
                    aria-label="미확인 라벨 추출 제안"
                    rows={4}
                    readOnly
                    value={suggestion.text}
                  />
                </label>
                <button
                  className="button"
                  onClick={() => {
                    setKind("label");
                    setOriginal(suggestion.text);
                    setSource(
                      suggestion.jobId ? `ai-job:${suggestion.jobId}` : "",
                    );
                    setCopiedSuggestion(true);
                    setCheckedOriginal(false);
                  }}
                >
                  제안을 검토할 입력칸으로 가져오기
                </button>
              </div>
            )}
          </details>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              관리 근거 종류
              <select
                disabled={busy}
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="user_observation">내가 직접 관찰한 내용</option>
                <option value="label">직접 읽은 관리 라벨</option>
                <option value="official_guidance">공식 관리 안내</option>
              </select>
            </label>
            <label>
              확인한 원문
              <textarea
                aria-label="확인한 원문"
                disabled={busy}
                required
                maxLength={5000}
                rows={4}
                value={original}
                onChange={(e) => {
                  setOriginal(e.target.value);
                  if (copiedSuggestion) setCheckedOriginal(false);
                }}
              />
            </label>
            <label>
              출처 또는 확인 위치 (선택)
              <input
                disabled={busy}
                maxLength={1000}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="예: 옷 안쪽 관리 라벨 / 공식 안내 주소"
              />
            </label>
            {copiedSuggestion && (
              <label className="evidence-confirm">
                <input
                  type="checkbox"
                  checked={checkedOriginal}
                  onChange={(e) => setCheckedOriginal(e.target.checked)}
                />
                실제 라벨과 대조해 원문을 확인했어요.
              </label>
            )}
            <button
              className="button"
              type="submit"
              disabled={
                busy ||
                !original.trim() ||
                (copiedSuggestion && !checkedOriginal)
              }
            >
              {busy ? "원문 저장 중…" : "확인한 원문 저장"}
            </button>
          </form>
        </>
      )}
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
    </details>
  );
}
