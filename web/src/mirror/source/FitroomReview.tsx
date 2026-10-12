import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import { rawApi, currentMember } from "./integrations/backendClient";
import { assetUrl } from "../../api.js";
import { captureRequest, type VtonResult } from "./pocVton";
import { loadCachedImage, invalidateImage } from "./imageBlobCache.js";
import type { OutfitDraft } from "./core/types";

export function FitroomReview({
  draft,
  person,
  consent,
  onResult,
}: {
  draft: OutfitDraft;
  person: string;
  consent: boolean;
  onResult: (result: VtonResult) => void;
}) {
  const [review, setReview] = useState<any>(null);
  const [mode, setMode] = useState("FIXTURE");
  const [hd, setHd] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false),
    alive = useRef(true),
    client = useRef<any>(rawApi());
  const owner = draft.ownerId;
  const resultIds = useRef(new Set<string>());
  const current = () => alive.current && currentMember()?.id === owner;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const id of resultIds.current) invalidateImage(id);
    };
  }, []);
  const run = async (action: () => Promise<any>) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (!current()) return;
      setReview(result);
      setConfirmed(false);
      if (result.status === "SUCCEEDED" && result.result_asset) {
        const a = result.result_asset;
        resultIds.current.add(a.asset_id);
        const url = await loadCachedImage({
          id: a.asset_id,
          version: 1,
          url: assetUrl(a.read_url),
          expiresAt: a.expires_at,
        });
        const image = new Image();
        image.src = url;
        await image.decode();
        if (current()) onResult({ ...result, url });
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const prepare = () =>
    run(() =>
      client.current.request("/integration/fitroom/reviews", {
        method: "POST",
        body: {
          mode,
          hd_mode: hd,
          request: captureRequest(
            draft,
            app.garments(),
            app.externalItems(),
            person,
            crypto.randomUUID(),
          ),
        },
      }),
    );
  const execute = () => {
    if (!review || !confirmed || !review.authorized || review.consumed) return;
    const fixed = review;
    // Latch before network; even a lost response never re-enables submission.
    setReview({ ...review, consumed: true, authorized: false });
    void run(() =>
      client.current.request(
        `/integration/fitroom/reviews/${fixed.job_id}/execute`,
        {
          method: "POST",
          body: {
            fingerprint: fixed.fingerprint,
            confirmed: true,
            person_asset_id: fixed.request_snapshot.person.asset_id,
          },
        },
      ),
    );
  };
  return (
    <section aria-label="FitRoom 비용 확인" data-fitroom-review>
      <strong>정적 이미지 시착 · 호출 전 확인</strong>
      <label>
        검증 모드{" "}
        <select
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value);
            setReview(null);
            setConfirmed(false);
          }}
        >
          <option value="FIXTURE">
            로컬 Fixture · 0크레딧 · 실제 시착 아님
          </option>
          <option value="LIVE">실제 FitRoom · 별도 승인 필요</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={hd}
          disabled={busy}
          onChange={(e) => {
            setHd(e.target.checked);
            setReview(null);
            setConfirmed(false);
          }}
        />
        HD 모드
      </label>
      <button
        disabled={busy || !person || !consent}
        onClick={() => void prepare()}
      >
        입력·예상 비용 확인
      </button>
      <small>
        상의+하의 또는 원피스만 지원합니다. 아우터·신발·액세서리는 자동 제외하지
        않습니다.
      </small>
      {review && (
        <div role="group" aria-label="시착 요청 확인">
          <p>
            프로필: {review.profile} · 모드: {review.mode} ·{" "}
            {review.request_snapshot.hd_mode ? "HD" : "일반"}
          </p>
          <p>
            예상 생성 비용:{" "}
            {review.mode === "FIXTURE" ? 0 : review.estimated_credits}크레딧 ·
            최대 생성 시도: 1회
          </p>
          <img
            src={
              review.prepared_inputs?.find(
                (i: any) => i.asset_id === review.person.asset_id,
              )?.data_uri
            }
            alt="요청 인물"
            width="64"
          />
          <ul>
            {review.items.map((i: any) => (
              <li key={`${i.kind}:${i.id}`}>
                <img
                  src={
                    review.prepared_inputs?.find(
                      (p: any) => p.asset_id === i.asset_id,
                    )?.data_uri
                  }
                  alt={i.name || i.slot}
                  width="48"
                />
                {i.slot} · {i.kind} · {i.name || i.id}
              </li>
            ))}
          </ul>
          <p>요청 ID: {review.job_id}</p>
          <p>
            {review.consumed
              ? "호출 권한 소진됨 · 생성 재시도 금지"
              : review.authorized
                ? "실행 가능"
                : "서버 승인 또는 실행 환경 확인 필요 · 호출 차단"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || review.consumed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            표시된 프로필·인물·의류·비용을 확인했습니다.
          </label>
          <button
            disabled={
              busy || !confirmed || !review.authorized || review.consumed
            }
            onClick={execute}
          >
            {review.mode === "FIXTURE"
              ? "무과금 Fixture 1회 실행"
              : "승인된 FitRoom 1회 실행"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                client.current.get(
                  `/integration/fitroom/reviews/${review.job_id}`,
                ),
              )
            }
          >
            저장된 상태 확인 · 공급자 호출 없음
          </button>
          {review.provider_job_known && (
            <button
              disabled={busy || !review.polling_allowed}
              onClick={() =>
                void run(() =>
                  client.current.request(
                    `/integration/fitroom/reviews/${review.job_id}/status`,
                    { method: "POST" },
                  ),
                )
              }
            >
              공급자 상태 확인 · 조회 과금 확인 후 허용
            </button>
          )}
          {review.mode === "FIXTURE" && (
            <p>
              합성 Fixture 응답입니다. 실제 FitRoom 시착 품질을 검증하지
              않습니다.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert">{error} · 생성 요청은 자동 재시도하지 않습니다.</p>
      )}
    </section>
  );
}
