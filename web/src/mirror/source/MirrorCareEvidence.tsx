import { useEffect, useRef, useState } from "react";
import type { Garment } from "./core/types";
import { HttpRemoteBackend } from "./integrations/backendClient";
import {
  careNotesEvidence,
  parseCareEvidence,
  careEvidencePresentation,
  type CareEvidenceItem,
} from "./careEvidence";
export type { CareEvidenceItem } from "./careEvidence";
const client = new HttpRemoteBackend();

export function MirrorCareEvidence({
  ownerId,
  garment,
  remote,
  evidence,
  onOpenOriginal,
  onEvidenceState,
}: {
  ownerId: string;
  garment: Garment;
  remote: boolean;
  evidence?: readonly CareEvidenceItem[];
  onEvidenceState?: (available: boolean | null) => void;
  onOpenOriginal: (evidence: CareEvidenceItem) => void;
}) {
  const localEvidence = (evidence ?? []).filter(
    (item) => item.ownerId === ownerId && item.garmentId === garment.id,
  );
  const key = JSON.stringify([
      ownerId,
      garment.id,
      garment.revision,
      remote,
      remote ? null : localEvidence,
    ]),
    current = useRef(key);
  current.current = key;
  const [load, setLoad] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
    items: CareEvidenceItem[];
  }>({ key: "", status: "ready", items: [] });
  const [index, setIndex] = useState(0),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setIndex(0);
    if (!remote || garment.ownerId !== ownerId) {
      try {
        const parsed = parseCareEvidence(
          { ownerId, garmentId: garment.id, evidence: localEvidence },
          ownerId,
          garment.id,
        );
        setLoad({ key, status: "ready", items: parsed.evidence });
      } catch {
        setLoad({ key, status: "error", items: [] });
      }
      return () => {
        active = false;
      };
    }
    setLoad({ key, status: "loading", items: [] });
    void client
      .request("/api/garments/" + encodeURIComponent(garment.id) + "/evidence")
      .then((value) => {
        if (!active || current.current !== key) return;
        const parsed = parseCareEvidence(value, ownerId, garment.id);
        setLoad({ key, status: "ready", items: parsed.evidence });
      })
      .catch(() => {
        if (active && current.current === key)
          setLoad({ key, status: "error", items: [] });
      });
    return () => {
      active = false;
    };
  }, [key, retry]);
  const scoped = load.key === key ? load : null,
    items = scoped?.items ?? [],
    item = items[Math.min(index, items.length - 1)],
    fallback = garment.ownerId === ownerId ? careNotesEvidence(garment) : null;
  const view = item ? careEvidencePresentation(item) : null,
    canGround =
      items.some((item) => careEvidencePresentation(item).canGroundCare) ||
      !!(fallback && careEvidencePresentation(fallback).canGroundCare);
  const notify = useRef(onEvidenceState);
  notify.current = onEvidenceState;
  useEffect(() => {
    notify.current?.(
      remote && (!scoped || scoped.status !== "ready") ? null : canGround,
    );
  }, [key, scoped?.status, canGround]);
  if (garment.ownerId !== ownerId)
    return (
      <div className="mirror-care-evidence">
        <p>현재 의류의 관리 근거를 확인해 주세요.</p>
      </div>
    );
  if (remote && (!scoped || scoped.status === "loading"))
    return (
      <div className="mirror-care-evidence">
        <p role="status">관리 근거를 확인하고 있어요.</p>
      </div>
    );
  if (item && view)
    return (
      <div
        className="mirror-care-evidence"
        data-evidence-id={item.id}
        data-evidence-garment={item.garmentId}
      >
        <strong>{view.title}</strong>
        <p data-care-verification={view.verificationState}>
          {view.summary || "연결된 라벨 사진을 열어 확인해 주세요."}
        </p>
        <small>{view.scope}</small>
        <small>
          {view.verificationLabel}
          {view.sourceDomain ? " · " + view.sourceDomain : ""}
        </small>
        <button
          type="button"
          onClick={() => {
            if (current.current === key) onOpenOriginal(structuredClone(item));
          }}
        >
          {item.asset ? "라벨 사진·원문 보기" : "근거 원문 보기"}
        </button>
        {items.length > 1 && (
          <div className="mirror-care-evidence-pages">
            <button
              type="button"
              aria-label="이전 관리 근거"
              disabled={index === 0}
              onClick={() => setIndex((value) => value - 1)}
            >
              이전
            </button>
            <small>
              {index + 1} / {items.length}
            </small>
            <button
              type="button"
              aria-label="다음 관리 근거"
              disabled={index === items.length - 1}
              onClick={() => setIndex((value) => value + 1)}
            >
              다음
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="mirror-care-evidence">
      {scoped?.status === "error" ? (
        <>
          <p role="status">관리 근거를 불러오지 못했어요.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            다시 확인
          </button>
        </>
      ) : (
        fallback && <strong>입력된 관리 근거</strong>
      )}
      <p>{garment.careNotes || "라벨 원본 미연결 · 확인된 관리법이 없어요."}</p>
      {fallback && (
        <>
          <button
            type="button"
            onClick={() => {
              if (current.current === key) onOpenOriginal(fallback);
            }}
          >
            입력 근거 전체 보기
          </button>
          <small>직접 입력한 텍스트 · 라벨 사진 아님</small>
        </>
      )}
      {!fallback && garment.careNotes && (
        <small>
          {garment.provenance.care === "demo"
            ? "시연 메모 · 실제 라벨 미확인"
            : "라벨 원본 연결 대기"}
        </small>
      )}
    </div>
  );
}
