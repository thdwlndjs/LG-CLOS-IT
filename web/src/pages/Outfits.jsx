import React, { useState } from "react";
import { allGarments, query, safeLink, upload } from "../api.js";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Load,
  Modal,
  Notice,
  Pager,
  Photo,
  SectionHead,
  Select,
  label,
  useAction,
  useLoad,
} from "../ui.jsx";

export const slots = ["TOP", "BOTTOM", "OUTER", "SHOES", "DRESS", "ACCESSORY"];
export function SlotPicker({ items, garments, onChange }) {
  return (
    <div className="slot-grid">
      {slots.map((slot) => (
        <Field key={slot} label={label(slot)}>
          <select
            aria-label={`${label(slot)} 선택`}
            value={items.find((x) => x.slot === slot)?.garment_id || ""}
            onChange={(e) =>
              onChange([
                ...items.filter((x) => x.slot !== slot),
                ...(e.target.value
                  ? [{ slot, garment_id: e.target.value, position: 0 }]
                  : []),
              ])
            }
          >
            <option value="">선택하지 않음</option>
            {garments
              .filter((g) => g.category === slot)
              .map((g) => (
                <option
                  value={g.id}
                  key={g.id}
                  disabled={g.status !== "AVAILABLE"}
                >
                  {label(g.color)} {label(g.category)} · {label(g.status)}
                </option>
              ))}
          </select>
        </Field>
      ))}
    </div>
  );
}
function Editor({ api, outfit, reference, onClose, onSaved }) {
  const state = useLoad((signal) => allGarments(api, signal), [api]);
  const [items, setItems] = useState(outfit?.items || []),
    [title, setTitle] = useState(outfit?.title || reference?.title || ""),
    [status, setStatus] = useState(outfit?.status || "SAVED");
  const action = useAction();
  return (
    <Modal
      title={outfit ? "코디 수정" : "나만의 코디 만들기"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const result = await api.send(
              outfit ? `/outfits/${outfit.id}` : "/outfits",
              { items, title, status },
              outfit ? "PATCH" : "POST",
              outfit?.version,
            );
            onSaved(result);
          });
        }}
      >
        <Field label="코디 이름">
          <input
            required
            value={title}
            maxLength="200"
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 가벼운 가을 출근룩"
          />
        </Field>
        {reference && (
          <Notice>
            참고 스타일: {reference.title}. 참고 이미지의 옷을 보유 의류로 자동
            등록하지 않습니다.
          </Notice>
        )}
        <Load state={state}>
          {(garments) => (
            <SlotPicker items={items} garments={garments} onChange={setItems} />
          )}
        </Load>
        <Field label="저장 상태">
          <Select
            values={["SAVED", "DRAFT"]}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </Field>
        <Notice>저장한 코디는 실제 착용 기록과 별개입니다.</Notice>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={action.busy || !items.length}>
            코디 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StyleForm({ api, member, onClose, onSaved }) {
  const [title, setTitle] = useState(""),
    [source, setSource] = useState("OTHER"),
    [url, setUrl] = useState(""),
    [file, setFile] = useState(null);
  const action = useAction();
  return (
    <Modal title="참고 스타일 추가" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            if (url && !safeLink(url))
              throw new Error("HTTP 또는 HTTPS 링크를 입력해주세요.");
            const asset = file ? await upload(api, file, "STYLE") : null;
            onSaved(
              await api.send("/style-references", {
                member_id: member.id,
                title,
                source,
                source_url: url || null,
                image_asset_id: asset?.asset_id || null,
              }),
            );
          });
        }}
      >
        <Field label="제목">
          <input
            required
            maxLength="200"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="출처">
          <Select
            values={[
              ["OTHER", "기타"],
              ["INSTAGRAM", "인스타그램"],
              ["SHOPPING", "쇼핑몰"],
            ]}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </Field>
        <Field label="참고 링크">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="참고 이미지">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </Field>
        <Notice>
          직접 제공한 자료만 저장하며 링크 이미지를 자동 수집하지 않습니다.
          사진은 마이의 업로드 동의가 필요합니다.
        </Notice>
        <ErrorBox error={action.error} />
        <button className="primary" disabled={action.busy}>
          스타일 저장
        </button>
      </form>
    </Modal>
  );
}
export function Outfits({ api, member, navigate, notify, reference }) {
  const [tab, setTab] = useState("looks"),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("SAVED"),
    [source, setSource] = useState(""),
    [editor, setEditor] = useState(reference ? {} : null),
    [styleForm, setStyleForm] = useState(false),
    [archive, setArchive] = useState(null),
    [deleteStyle, setDeleteStyle] = useState(null);
  const action = useAction();
  const outfits = useLoad(
    (signal) =>
      api.get("/outfits?" + query({ status: filter, limit: 12, offset }), {
        signal,
      }),
    [api, filter, offset],
  );
  const styles = useLoad(
    (signal) =>
      api.get("/style-references?" + query({ source, limit: 12, offset }), {
        signal,
      }),
    [api, source, offset],
  );
  return (
    <>
      <SectionHead eyebrow="CURATED BY YOU" title="나의 취향을 모으다.">
        <button onClick={() => navigate("cards")}>코디카드 보관함</button>
        <button
          className="primary"
          onClick={() => (tab === "looks" ? setEditor({}) : setStyleForm(true))}
        >
          ＋ {tab === "looks" ? "코디 만들기" : "스타일 추가"}
        </button>
      </SectionHead>
      <div className="tabs">
        {[
          ["looks", "내 코디"],
          ["styles", "스타일 보관함"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => {
              setTab(v);
              setOffset(0);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorBox error={action.error} />
      {tab === "looks" ? (
        <>
          <div className="filters">
            <Field label="코디 상태">
              <Select
                values={["SAVED", "DRAFT", "ARCHIVED", ""].map((x) => [
                  x,
                  x ? label(x) : "전체",
                ])}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setOffset(0);
                }}
              />
            </Field>
            <button onClick={outfits.reload}>새로고침</button>
          </div>
          <Load state={outfits}>
            {(data) => (
              <>
                {data.items.length ? (
                  <div className="grid three">
                    {data.items.map((o) => (
                      <article className="panel look-card" key={o.id}>
                        <div className="look-preview">
                          {o.items.slice(0, 3).map((x) => (
                            <Photo key={x.garment_id} category={x.slot} />
                          ))}
                        </div>
                        <Badge>{o.status}</Badge>
                        <h3>{o.title}</h3>
                        <p>{o.items.map((x) => label(x.slot)).join(" · ")}</p>
                        {o.missing_garment_ids.length > 0 && (
                          <Notice>
                            삭제되거나 접근할 수 없는 옷이 포함되어 있어요.
                          </Notice>
                        )}
                        <div className="actions wrap">
                          <button
                            className="primary"
                            disabled={
                              !o.try_on_ready || o.status === "ARCHIVED"
                            }
                            onClick={() =>
                              navigate("tryon", {
                                outfitId: o.id,
                                source: "MY_OUTFITS",
                              })
                            }
                          >
                            입어보기
                          </button>
                          <button
                            onClick={() =>
                              navigate("cards", { outfitId: o.id })
                            }
                          >
                            카드 만들기
                          </button>
                          {o.status !== "ARCHIVED" && (
                            <>
                              <button onClick={() => setEditor(o)}>수정</button>
                              <button onClick={() => setArchive(o)}>
                                보관
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty title="저장된 코디가 없어요">
                    옷장에서 아이템을 골라 나만의 코디를 만들어보세요.
                  </Empty>
                )}
                <Pager page={data.page} onPage={setOffset} />
              </>
            )}
          </Load>
        </>
      ) : (
        <>
          <div className="filters">
            <Field label="스타일 출처">
              <Select
                values={[
                  ["", "전체"],
                  ["INSTAGRAM", "인스타그램"],
                  ["SHOPPING", "쇼핑몰"],
                  ["OTHER", "기타"],
                ]}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setOffset(0);
                }}
              />
            </Field>
            <button onClick={styles.reload}>새로고침</button>
          </div>
          <Load state={styles}>
            {(data) => (
              <>
                {data.items.length ? (
                  <div className="grid three">
                    {data.items.map((s) => (
                      <article className="panel" key={s.id}>
                        <Photo asset={s.image} />
                        <Badge>
                          {s.source === "INSTAGRAM"
                            ? "인스타그램"
                            : s.source === "SHOPPING"
                              ? "쇼핑몰"
                              : "기타"}
                        </Badge>
                        <h3>{s.title}</h3>
                        {safeLink(s.source_url) && (
                          <a
                            className="text-button"
                            href={safeLink(s.source_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            참고 링크 ↗
                          </a>
                        )}
                        <div className="actions wrap">
                          <button onClick={() => setEditor({ reference: s })}>
                            참고해서 코디 만들기
                          </button>
                          <button
                            className="danger-text"
                            onClick={() => setDeleteStyle(s)}
                          >
                            삭제
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty title="모아둔 스타일이 없어요">
                    마음에 드는 스타일의 링크나 사진을 추가해주세요.
                  </Empty>
                )}
                <Pager page={data.page} onPage={setOffset} />
              </>
            )}
          </Load>
        </>
      )}
      {editor && (
        <Editor
          api={api}
          outfit={editor.id ? editor : null}
          reference={editor.reference || reference}
          onClose={() => setEditor(null)}
          onSaved={(o) => {
            setEditor(null);
            setTab("looks");
            setFilter(o.status);
            outfits.reload();
            notify("코디를 저장했어요. 입어보기에서 이어갈 수 있어요.");
          }}
        />
      )}
      {styleForm && (
        <StyleForm
          api={api}
          member={member}
          onClose={() => setStyleForm(false)}
          onSaved={() => {
            setStyleForm(false);
            styles.reload();
            notify("참고 스타일을 저장했어요.");
          }}
        />
      )}
      {archive && (
        <Modal title="코디 보관" onClose={() => setArchive(null)}>
          <p>이 코디를 보관하면 입어보기에 사용할 수 없습니다. 계속할까요?</p>
          <ErrorBox error={action.error} />
          <button
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await api.send(
                  `/outfits/${archive.id}`,
                  {
                    title: archive.title,
                    items: archive.items,
                    status: "ARCHIVED",
                  },
                  "PATCH",
                  archive.version,
                );
                setArchive(null);
                outfits.reload();
              })
            }
          >
            보관 확인
          </button>
        </Modal>
      )}
      {deleteStyle && (
        <Modal title="스타일 삭제" onClose={() => setDeleteStyle(null)}>
          <p>{deleteStyle.title}을 삭제할까요?</p>
          <ErrorBox error={action.error} />
          <button
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await api.send(
                  `/style-references/${deleteStyle.id}`,
                  undefined,
                  "DELETE",
                );
                setDeleteStyle(null);
                styles.reload();
              })
            }
          >
            삭제 확인
          </button>
        </Modal>
      )}
    </>
  );
}
