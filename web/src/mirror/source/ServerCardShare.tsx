import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import { api, currentMember } from "./integrations/backendClient";
import { assetUrl } from "../../api.js";
import { serverCommand } from "./secondHandoffActions";

export function ServerCardShare({ outfitId }: { outfitId: string }) {
  const owner = app.getState().activeProfileId,
    repository = app.repository;
  const [busy, setBusy] = useState(false),
    [link, setLink] = useState<string | null>(null),
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
    app.repository === repository;
  const share = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      let card: any;
      for (let offset = 0; !card; offset += 100) {
        const page: any = await api().get(`/cards?limit=100&offset=${offset}`);
        if (!current()) return;
        card = page.items.find(
          (c: any) => c.is_saved && c.outfit_id === outfitId && c.image_asset,
        );
        if (page.items.length < 100) break;
      }
      if (!card) throw Error("서버에서 생성·저장한 카드 이미지가 없습니다.");
      const payload = { visibility: "SHAREABLE", reuse_outfit: false };
      const result: any = await serverCommand(
        `share:${intent.current}`,
        { cardId: card.id },
        (step) => step("share", "POST", `/cards/${card.id}/save`, payload),
      );
      if (!current()) return;
      const url = assetUrl(result.share_url);
      if (!url) throw Error("공유 주소를 확인할 수 없습니다.");
      setLink(url);
      setMessage(
        "공유 링크는 24시간 후 만료됩니다. 링크를 가진 사람이 카드 이미지를 볼 수 있습니다.",
      );
    } catch (e) {
      if (current()) setMessage((e as Error).message);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <div className="mx-card-share">
      <button type="button" disabled={busy} onClick={() => void share()}>
        {busy ? "공유 확인 중" : "카드 이미지 공유"}
      </button>
      {link && (
        <a href={link} target="_blank" rel="noreferrer">
          공유 이미지 열기
        </a>
      )}
      {message && <small role="status">{message}</small>}
    </div>
  );
}
