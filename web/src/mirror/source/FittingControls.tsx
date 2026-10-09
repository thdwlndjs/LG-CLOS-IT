import { lookupSavedFitting } from "./savedFittingLookup";
import { mirrorFittingSession } from "./mirrorFittingSession";
import { useEffect, useRef, useState } from "react";
import type { DemoApp } from "./core/app";
import type { Asset } from "./core/types";
import { HttpRemoteBackend } from "./integrations/backendClient";
import { DecartRealtimeController } from "./integrations/decartRealtime";
import {
  fittingSnapshotsMatch,
  type FittingSnapshot,
  type FittingCandidate,
  type FittingRequest,
  type FittingStreamBinding,
} from "./mirrorScene";
import { FittingResultRecovery } from "./fittingResultRecovery";
import {
  FittingStreamSession,
  stopFittingStream,
} from "./fittingStreamSession";
const client = new HttpRemoteBackend();
export {
  lookupSavedFitting,
  type SavedFittingLookup,
} from "./savedFittingLookup";
export type FittingInputSelection = {
  ownerId: string;
  person: Asset | null;
  reference: Asset | null;
};
export function FittingControls({
  app,
  sceneSnapshot,
  onSceneResult,
  onSceneRequest,
  onSceneStream,
  retainedInputs,
  onInputsChange,
}: {
  app: DemoApp;
  sceneSnapshot: FittingSnapshot | null;
  onSceneStream?: (value: FittingStreamBinding | null) => void;
  onSceneResult: (value: FittingCandidate | null) => void;
  onSceneRequest: (value: FittingRequest | null) => void;
  retainedInputs: FittingInputSelection | null;
  onInputsChange: (value: FittingInputSelection) => void;
}) {
  const currentScene = useRef(sceneSnapshot);
  currentScene.current = sceneSnapshot;
  const submittedScene = useRef<FittingSnapshot | null>(null);
  const streamCallbacks = useRef({
    stream: onSceneStream,
    result: onSceneResult,
    request: onSceneRequest,
  });
  streamCallbacks.current = {
    stream: onSceneStream,
    result: onSceneResult,
    request: onSceneRequest,
  };
  const streamSession = useRef(
    new FittingStreamSession((binding) => {
      streamCallbacks.current.stream?.(binding);
      if (!binding) {
        streamCallbacks.current.result(null);
        streamCallbacks.current.request(null);
      }
    }),
  );
  const [confirmedInputs, setConfirmedInputs] = useState<string | null>(null);
  const [person, setPerson] = useState<Asset | null>(
      retainedInputs?.ownerId === app.getState().activeProfileId
        ? retainedInputs.person
        : null,
    ),
    [reference, setReference] = useState<Asset | null>(
      retainedInputs?.ownerId === app.getState().activeProfileId
        ? retainedInputs.reference
        : null,
    ),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState<string | null>(null),
    [resultUrl, setResultUrl] = useState<string | null>(null),
    [path, setPath] = useState<"batch" | "realtime">("batch");
  const [resultKind, setResultKind] = useState<"image" | "video">("video"),
    [operationMode, setOperationMode] = useState<
      "live" | "saved_result" | null
    >(null);
  const operationModeRef = useRef<"live" | "saved_result" | null>(null);
  const video = useRef<HTMLVideoElement>(null),
    inputVideo = useRef<HTMLVideoElement>(null),
    controller = useRef(new DecartRealtimeController()),
    generation = useRef(0),
    resultFingerprint = useRef(""),
    operationRef = useRef<string | null>(null),
    recovery = useRef(
      new FittingResultRecovery((url) => URL.revokeObjectURL(url)),
    ),
    inputStream = useRef<MediaStream | null>(null),
    mounted = useRef(true);
  const sharedOperation = useRef(false);
  useEffect(
    () =>
      mirrorFittingSession.subscribe({
        onState: (value) => {
          if (sharedOperation.current && mounted.current)
            setMessage(value.message);
        },
        onRequest: (value) => {
          if (sharedOperation.current) streamCallbacks.current.request(value);
        },
        onStream: (value) => {
          if (sharedOperation.current) streamCallbacks.current.stream?.(value);
        },
        onResult: (value) => {
          if (!sharedOperation.current || !mounted.current) return;
          if (
            value &&
            !fittingSnapshotsMatch(value.snapshot, currentScene.current)
          )
            return;
          streamCallbacks.current.result(value);
          if (
            value?.media?.kind === "image" ||
            value?.media?.kind === "video"
          ) {
            setResultKind(value.media.kind);
            setResultUrl(value.media.url);
          } else setResultUrl(null);
        },
      }),
    [],
  );

  const fingerprint = () =>
    JSON.stringify({
      scene: currentScene.current,
      owner: app.getState().activeProfileId,
      person: person && { id: person.id, version: person.version },
      reference: reference && { id: reference.id, version: reference.version },
      draft: app.outfitDraft(),
      assets: app
        .garments()
        .filter((g) =>
          Object.values(app.outfitDraft()?.items ?? {}).includes(g.id),
        )
        .map((g) => ({
          id: g.id,
          asset: g.asset && { id: g.asset.id, version: g.asset.version },
        })),
    });
  const samePersonConfirmed =
    confirmedInputs !== null && confirmedInputs === fingerprint();
  const recoveryIdentity = () =>
    currentScene.current
      ? { snapshot: currentScene.current, inputFingerprint: fingerprint() }
      : null;
  const restoreSuccessfulResult = () => {
    const retained = recovery.current.read(recoveryIdentity());
    if (!retained || !mounted.current) return false;
    setResultKind(retained.result.media.kind);
    setResultUrl(retained.result.media.url);
    onSceneRequest(retained.request);
    onSceneResult(retained.result);
    return true;
  };
  const stop = async ({
    preserveResult = false,
  }: { preserveResult?: boolean } = {}) => {
    generation.current++;
    submittedScene.current = null;
    streamSession.current.clear();
    const retained = preserveResult
      ? recovery.current.read(recoveryIdentity())
      : null;
    if (!retained) recovery.current.clear();
    onSceneResult(retained?.result ?? null);
    onSceneRequest(retained?.request ?? null);
    const id =
      !sharedOperation.current && operationModeRef.current === "live"
        ? operationRef.current
        : null;
    operationRef.current = null;
    operationModeRef.current = null;
    inputVideo.current?.pause();
    inputStream.current?.getTracks().forEach((track) => track.stop());
    inputStream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
      if (!retained) {
        video.current.removeAttribute("src");
        video.current.load();
      }
    }
    if (mounted.current) {
      setResultUrl(retained?.result.media.url ?? null);
      if (retained) setResultKind(retained.result.media.kind);
    }
    await controller.current.stop();
    if (id)
      await client
        .request(`/api/try-on/${id}/stop`, "POST", {})
        .catch(() => {});
  };
  useEffect(() => {
    mounted.current = true;
    const unregister = app.registerTryOnCleanup(() => {
      void stop();
      void mirrorFittingSession.stop();
    });
    return () => {
      mounted.current = false;
      unregister();
      void stop();
    };
  }, []);
  useEffect(() => {
    setConfirmedInputs(null);
  }, [sceneSnapshot?.person.assetId, sceneSnapshot?.person.assetVersion]);
  useEffect(() => {
    if (!recovery.current.read(recoveryIdentity()) && resultUrl) {
      setResultUrl(null);
      onSceneResult(null);
      onSceneRequest(null);
    }
    if (
      streamSession.current.hasStream &&
      (fingerprint() !== resultFingerprint.current ||
        !streamSession.current.reconcile(currentScene.current))
    )
      void stop();
  }, [sceneSnapshot, person, reference, app.getState().activeProfileId]);
  useEffect(() => {
    if (!sceneSnapshot) return;
    if (!samePersonConfirmed) {
      mirrorFittingSession.unregisterInputs(sceneSnapshot);
      return;
    }
    if (!person || !reference) return;
    try {
      mirrorFittingSession.registerInputs({
        snapshot: sceneSnapshot,
        person,
        reference,
        samePersonConfirmed: true,
        fullOutfitConfirmed: true,
        transferConsent: consent,
      });
    } catch {
      /* The mirror keeps this input unavailable until private asset references are confirmed. */
    }
  }, [sceneSnapshot, person, reference, samePersonConfirmed, consent]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) {
        const restored = restoreSuccessfulResult();
        setMessage(
          (e instanceof Error
            ? e.message
            : "피팅 요청을 확인하지 못했습니다.") +
            (restored ? " 이전 정상 피팅 결과를 유지합니다." : ""),
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const upload = async (
    file: File | undefined,
    kind: "person_video" | "outfit_reference",
  ) => {
    if (!file) return;
    await run(async () => {
      await stop();
      const currentGeneration = generation.current;
      const owner = app.getState().activeProfileId;
      const asset = await client.upload(file, kind, consent ? ["decart"] : []);
      if (
        !mounted.current ||
        currentGeneration !== generation.current ||
        owner !== app.getState().activeProfileId
      )
        return;
      if (kind === "person_video") setPerson(asset);
      else setReference(asset);
      onInputsChange({
        ownerId: owner,
        person: kind === "person_video" ? asset : person,
        reference: kind === "outfit_reference" ? asset : reference,
      });
      setMessage(
        "Supabase 비공개 저장소에 확정했습니다. Decart로 전송하지 않았습니다.",
      );
    });
  };
  const loadSaved = async () => {
    if (sharedOperation.current) {
      await mirrorFittingSession.stop();
      sharedOperation.current = false;
    }
    if (!person || !reference || !samePersonConfirmed || !currentScene.current)
      throw new Error(
        "중앙 인물·전체 코디와 두 입력 자산의 일치 확인이 필요합니다.",
      );
    const draft = app.outfitDraft();
    if (!draft) throw new Error("현재 코디를 먼저 선택해 주세요.");
    const expected = fingerprint(),
      sceneAtSubmission = structuredClone(currentScene.current),
      owner = app.getState().activeProfileId;
    // Stop prior work, retaining only an exact-input success; a saved lookup is never a cancellable provider job.
    const stoppedGeneration = generation.current + 1;
    await stop({ preserveResult: true });
    if (
      !mounted.current ||
      generation.current !== stoppedGeneration ||
      owner !== app.getState().activeProfileId ||
      expected !== fingerprint()
    )
      return;
    const token = ++generation.current;
    submittedScene.current = sceneAtSubmission;
    setOperation(null);
    setOperationMode("saved_result");
    onSceneRequest({ snapshot: sceneAtSubmission, status: "processing" });
    const current = () =>
      mounted.current &&
      token === generation.current &&
      owner === app.getState().activeProfileId &&
      expected === fingerprint() &&
      fittingSnapshotsMatch(currentScene.current, sceneAtSubmission);
    try {
      const result = await lookupSavedFitting(
        { draft, person, reference, snapshot: sceneAtSubmission },
        {
          request: (url, method, body) => client.request(url, method, body),
          fetch: (...args) => fetch(...args),
          isCurrent: current,
        },
      );
      if (!current() || result.status === "stale") return;
      if (result.status === "unavailable") {
        const restored = restoreSuccessfulResult();
        if (!restored)
          onSceneRequest({
            snapshot: sceneAtSubmission,
            status: "unavailable",
          });
        setMessage(
          result.message +
            (restored ? " 이전 정상 피팅 결과를 유지합니다." : ""),
        );
        return;
      }
      const url = URL.createObjectURL(result.blob);
      if (!current()) {
        URL.revokeObjectURL(url);
        return;
      }
      const candidate: FittingCandidate = {
        snapshot: sceneAtSubmission,
        origin: "saved",
        content: "fitting-result",
        status: "ready",
        resultId: result.resultId,
        operationId: result.operationId,
        media: { kind: result.mediaKind, url },
      };
      try {
        recovery.current.replace(
          { snapshot: sceneAtSubmission, inputFingerprint: expected },
          candidate,
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      operationRef.current = result.operationId;
      operationModeRef.current = "saved_result";
      resultFingerprint.current = expected;
      setOperation(result.operationId);
      setResultKind(result.mediaKind);
      setResultUrl(url);
      onSceneRequest({ snapshot: sceneAtSubmission, status: "completed" });
      onSceneResult({
        snapshot: sceneAtSubmission,
        origin: "saved",
        content: "fitting-result",
        status: "ready",
        resultId: result.resultId,
        operationId: result.operationId,
        media: { kind: result.mediaKind, url },
      });
      setMessage(
        "저장된 피팅 결과를 불러왔습니다. 새 공급자 실행·과금 요청 없음 · 재생 품질은 직접 확인해 주세요.",
      );
    } catch (error) {
      if (!current()) return;
      onSceneRequest({ snapshot: sceneAtSubmission, status: "unavailable" });
      throw error;
    }
  };
  const connectMirror = async () => {
    if (
      !person ||
      !reference ||
      !consent ||
      !samePersonConfirmed ||
      !currentScene.current
    )
      throw new Error("동일 인물·전체 코디 확인과 전송 동의가 필요합니다.");
    const draft = app.outfitDraft();
    if (!draft) throw new Error("현재 코디를 먼저 선택해 주세요.");
    mirrorFittingSession.bindContext(
      app.getState().activeProfileId,
      app.repository,
    );
    const expected = fingerprint(),
      snapshot = structuredClone(currentScene.current);
    mirrorFittingSession.registerInputs({
      snapshot,
      person,
      reference,
      samePersonConfirmed: true,
      fullOutfitConfirmed: true,
      transferConsent: consent,
    });
    const result = await mirrorFittingSession.prepareExecution(
      snapshot,
      draft,
      path,
      () => mounted.current && expected === fingerprint(),
    );
    if (result.status !== "stale" && mounted.current)
      setMessage(result.message);
    return { result, snapshot, draft };
  };
  const start = async () => {
    const prepared = await connectMirror();
    if (prepared.result.status !== "ready") return;
    await stop();
    sharedOperation.current = true;
    const result = await mirrorFittingSession.submitSelected(
      prepared.snapshot,
      prepared.draft,
    );
    if (
      !mounted.current ||
      !fittingSnapshotsMatch(currentScene.current, prepared.snapshot)
    )
      return;
    const currentOperation = mirrorFittingSession.getCurrentOperation();
    setOperation(currentOperation?.operationId ?? null);
    setOperationMode(currentOperation ? "live" : null);
    setMessage(result.message);
  };

  const showResult = async () => {
    if (sharedOperation.current) {
      const result = await mirrorFittingSession.loadBatchResult();
      if (mounted.current) setMessage(result.message);
      return;
    }
    if (!operation || !submittedScene.current)
      throw new Error("조회할 작업이 없습니다.");
    const requestedOperation = operation,
      expected = resultFingerprint.current,
      sceneAtSubmission = structuredClone(submittedScene.current),
      token = generation.current;
    const current = () =>
      mounted.current &&
      token === generation.current &&
      fingerprint() === expected &&
      operationRef.current === requestedOperation &&
      fittingSnapshotsMatch(currentScene.current, sceneAtSubmission);
    if (!current())
      throw new Error(
        "현재 코디가 변경되어 이전 조합 결과를 표시하지 않습니다.",
      );
    const res = await fetch(`/api/try-on/${requestedOperation}/result`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message ?? "결과 확보 전입니다.");
    }
    const mime = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!["video/mp4", "video/webm"].includes(mime))
      throw new Error(
        "확인된 피팅 영상 파일이 아닙니다. 이전 정상 결과는 유지합니다.",
      );
    const blob = await res.blob();
    if (!current())
      throw new Error(
        "변경되거나 종료된 인물·코디의 결과를 적용하지 않습니다.",
      );
    if (!blob.size)
      throw new Error(
        "피팅 결과 파일이 비어 있습니다. 이전 정상 결과는 유지합니다.",
      );
    const url = URL.createObjectURL(blob);
    const candidate: FittingCandidate = {
      snapshot: sceneAtSubmission,
      origin: "provider-batch",
      content: "fitting-result",
      status: "ready",
      operationId: requestedOperation,
      media: { kind: "video", url },
    };
    try {
      recovery.current.replace(
        { snapshot: sceneAtSubmission, inputFingerprint: expected },
        candidate,
      );
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    setResultKind("video");
    setResultUrl(url);
    onSceneRequest({ snapshot: sceneAtSubmission, status: "completed" });
    onSceneResult(candidate);
    setMessage(
      "현재 인물·코디와 일치하는 배치 결과 파일 확보 · 영상 재생 확인 전",
    );
  };
  if (app.connection.kind !== "supabase")
    return (
      <p>
        실제 피팅 입력은 마이에서 본인 Supabase 계정을 연결한 뒤 선택할 수
        있습니다.
      </p>
    );
  return (
    <div className="fitting-controls">
      <p>준비 영상 입력 · 카메라/마이크 자동 사용 없음</p>
      <p>
        이 탭에서 선택한 입력은 메뉴를 바꿔도 유지됩니다. 새로고침·계정 전환 시
        다시 선택해야 합니다.
      </p>
      {person && <p>인물 영상 선택됨 · 자산 버전 {person.version}</p>}
      {reference && (
        <p>전체 코디 참조 선택됨 · 자산 버전 {reference.version}</p>
      )}
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (!e.target.checked) {
              void stop();
              void mirrorFittingSession.stop();
            }
          }}
        />{" "}
        선택한 영상과 코디 참조를 Decart 시험에 사용할 권한이 있으며 전송에
        동의합니다. 비용 승인은 별도입니다.
      </label>
      <label>
        인물 영상 (MP4/H.264)
        <input
          type="file"
          accept="video/mp4"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0], "person_video")}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={samePersonConfirmed}
          onChange={(e) => {
            setConfirmedInputs(e.target.checked ? fingerprint() : null);
            if (!e.target.checked) {
              void stop();
              void mirrorFittingSession.stop();
            }
          }}
        />
        입력 영상은 중앙에 선택한 사진과 같은 인물이며, 현재 전체 코디 참조를
        사용합니다.
      </label>
      <label>
        전체 코디 단일 참조
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0], "outfit_reference")}
        />
      </label>
      <button
        disabled={
          busy ||
          !person ||
          !reference ||
          !samePersonConfirmed ||
          !sceneSnapshot
        }
        onClick={() => void run(loadSaved)}
      >
        저장된 피팅 결과 조회 · 새 API 실행 없음
      </button>
      <p>
        같은 입력·코디 버전으로 저장된 배치 결과만 읽습니다. 없으면 생성하지
        않습니다.
      </p>
      <label>
        시험 경로
        <select
          value={path}
          onChange={(e) => {
            void stop();
            setPath(e.target.value as "batch" | "realtime");
          }}
        >
          <option value="batch">영상 배치</option>
          <option value="realtime">
            준비 영상의 실시간 변환 · 상한 검증 대기
          </option>
        </select>
      </label>
      <button
        disabled={
          busy ||
          !person ||
          !reference ||
          !consent ||
          !samePersonConfirmed ||
          !sceneSnapshot
        }
        onClick={() =>
          void run(async () => {
            await connectMirror();
          })
        }
      >
        검증된 실행 조건을 미러에 연결 · 실행 없음
      </button>
      <button
        disabled={
          busy ||
          !person ||
          !reference ||
          !consent ||
          !samePersonConfirmed ||
          !sceneSnapshot
        }
        onClick={() => void run(start)}
      >
        승인 조건 확인 후 시작
      </button>
      {operation && operationMode === "live" && (
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await client.request<{
                  processing_status: string;
                  file_status: string;
                }>(`/api/try-on/${operation}/status`);
                setMessage(
                  `작업 ${r.processing_status} · 파일 ${r.file_status}`,
                );
              })
            }
          >
            원 작업 상태 조회
          </button>
          <button disabled={busy} onClick={() => void run(showResult)}>
            결과 파일 확인
          </button>
        </div>
      )}
      <button
        onClick={() =>
          void run(async () => {
            await stop();
            await mirrorFittingSession.stop();
            setMessage(
              "종료 요청 · 공급자 접수 작업은 원 상태 조회로 확인합니다.",
            );
          })
        }
      >
        연결 종료
      </button>
      <video ref={inputVideo} muted playsInline hidden />
      {resultUrl && resultKind === "image" && (
        <img
          src={resultUrl}
          alt="저장된 피팅 결과"
          style={{ maxWidth: "100%" }}
          onError={() =>
            setMessage("저장된 결과 이미지를 표시하지 못했습니다.")
          }
        />
      )}
      <video
        ref={video}
        src={resultKind === "video" ? (resultUrl ?? undefined) : undefined}
        controls
        playsInline
        onLoadedData={() =>
          setMessage("결과 재생 가능 · 의류 표현 품질은 직접 확인해 주세요.")
        }
        onError={() => setMessage("결과 파일 재생을 확인하지 못했습니다.")}
        style={{
          display:
            (resultUrl && resultKind === "video") || path === "realtime"
              ? "block"
              : "none",
          maxWidth: "100%",
        }}
      />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
