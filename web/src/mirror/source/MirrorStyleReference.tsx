import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import type { Asset } from "./core/types";
import { HttpRemoteBackend } from "./integrations/backendClient";
const client = new HttpRemoteBackend();
/** The existing individual private upload pathway. Selecting a file alone performs no request. */
export function MirrorStyleReference({
  onBack,
  onUseReference,
}: {
  onBack: () => void;
  onUseReference: (assetId: string) => void;
}) {
  const owner = app.getState().activeProfileId,
    repository = app.repository;
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [asset, setAsset] = useState<Asset | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const choose = (value: File | undefined) => {
    if (!value) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(value.type) ||
      value.size > 10 * 1024 * 1024
    ) {
      setMessage("PNG·JPEG·WebP 10MB 이하 사진을 선택해 주세요.");
      return;
    }
    generation.current++;
    setFile(value);
    setAsset(null);
    setMessage("사진 선택됨 · 아직 전송하지 않았어요.");
  };
  const upload = async () => {
    if (!file || busy) return;
    const token = ++generation.current;
    const current = () =>
      generation.current === token &&
      app.getState().activeProfileId === owner &&
      app.repository === repository &&
      app.connection.kind === "supabase";
    setBusy(true);
    try {
      const result = await client.upload(
        file,
        "style_reference",
        consent ? ["openai"] : [],
      );
      if (current()) {
        setAsset(result);
        setMessage("참고를 비공개 보관했어요. AI는 실행하지 않았어요.");
      }
    } catch (e) {
      if (current()) setMessage((e as Error).message);
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <div className="mow-style-detail mow-style-upload">
      <button type="button" onClick={onBack}>
        ← 스타일 보관함
      </button>
      <strong>사진을 참고해 내 옷으로</strong>
      <p>사용할 수 있는 참고 사진 한 장을 선택하세요.</p>
      <label className="mow-label">
        {file ? "사진 바꾸기" : "스타일 참고 사진"}
        <input
          aria-label="스타일 참고 사진"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {preview && (
        <img src={preview} alt="선택한 참고 사진 · 아직 의류 등록 아님" />
      )}
      {!asset ? (
        <>
          <label className="mow-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            이 사진의 OpenAI 전송 허용 · 실행 비용 승인은 별도
          </label>
          <button
            type="button"
            disabled={!file || busy || app.connection.kind !== "supabase"}
            onClick={() => void upload()}
          >
            {busy ? "보관 중" : "비공개 참고로 보관"}
          </button>
          {app.connection.kind !== "supabase" && (
            <small>
              앱 계정 연결 후 보관할 수 있어요. 사진 선택은 유지돼요.
            </small>
          )}
        </>
      ) : (
        <button type="button" onClick={() => onUseReference(asset.id)}>
          내 옷으로 재구성 제안
        </button>
      )}
      {file && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            generation.current++;
            setFile(null);
            setAsset(null);
            setMessage(
              "사진 선택을 지웠어요. 저장된 원본 자료는 삭제하지 않았어요.",
            );
          }}
        >
          사진 선택 취소
        </button>
      )}
      <p className="mow-status" role="status">
        {message}
      </p>
    </div>
  );
}
