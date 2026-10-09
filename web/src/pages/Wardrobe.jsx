import React, { useState } from "react";
import { query, upload } from "../api.js";
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
  time,
  useAction,
  useLoad,
} from "../ui.jsx";

const categories = ["TOP", "BOTTOM", "OUTER", "SHOES", "DRESS", "ACCESSORY"];
const colors = [
  "WHITE",
  "BLACK",
  "GRAY",
  "BEIGE",
  "BLUE",
  "RED",
  "GREEN",
  "BROWN",
  "OTHER",
];
const defaults = {
  category: "TOP",
  color: "WHITE",
  material: "",
  care_label: "",
  season_tags: [],
  shared_with_member_ids: [],
};
function GarmentForm({ api, member, garment, onClose, onSaved }) {
  const [form, set] = useState(
      garment ? { ...defaults, ...garment } : defaults,
    ),
    [file, setFile] = useState(null),
    [consent, setConsent] = useState(false);
  const action = useAction();
  const field = (key, value) => set({ ...form, [key]: value });
  const save = (e) => {
    e.preventDefault();
    action.run(async () => {
      if (file && !consent)
        throw new Error(
          "사진 업로드 동의 확인이 필요합니다. 마이에서 동의를 설정해주세요.",
        );
      const image = file ? await upload(api, file, "GARMENT") : null;
      const body = {
        owner_id: member.id,
        category: form.category,
        color: form.color,
        material: form.material || null,
        care_label: form.care_label || null,
        season_tags: form.season_tags,
        image_asset_id: image?.asset_id || garment?.image?.asset_id || null,
        shared_with_member_ids: form.shared_with_member_ids,
      };
      const result = await api.send(
        garment ? `/garments/${garment.id}` : "/garments",
        body,
        garment ? "PATCH" : "POST",
        garment?.version,
      );
      onSaved(result);
    });
  };
  return (
    <Modal
      title={garment ? "옷 정보 수정" : "새로운 옷 등록"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="grid two">
          <Field label="종류">
            <Select
              values={categories}
              value={form.category}
              onChange={(e) => field("category", e.target.value)}
            />
          </Field>
          <Field label="색상">
            <Select
              values={colors}
              value={form.color}
              onChange={(e) => field("color", e.target.value)}
            />
          </Field>
        </div>
        <Field label="소재">
          <input
            value={form.material || ""}
            onChange={(e) => field("material", e.target.value)}
            maxLength="100"
            placeholder="예: 면 100%"
          />
        </Field>
        <Field label="케어라벨">
          <textarea
            value={form.care_label || ""}
            onChange={(e) => field("care_label", e.target.value)}
            placeholder="옷에 적힌 관리 지침을 입력하세요"
          />
        </Field>
        <fieldset>
          <legend>계절</legend>
          <div className="checks">
            {["SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"].map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={form.season_tags.includes(s)}
                  onChange={(e) =>
                    field(
                      "season_tags",
                      e.target.checked
                        ? [...form.season_tags, s]
                        : form.season_tags.filter((x) => x !== s),
                    )
                  }
                />
                {label(s)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={form.shared_with_member_ids.length > 0}
            onChange={(e) =>
              field(
                "shared_with_member_ids",
                e.target.checked
                  ? [
                      member.id.endsWith("1")
                        ? "20000000-0000-4000-8000-000000000002"
                        : "20000000-0000-4000-8000-000000000001",
                    ]
                  : [],
              )
            }
          />
          다른 데모 가족에게 읽기 공유
        </label>
        <Field label="의류 사진 (선택)">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </Field>
        {file && (
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            마이에서 사진 동의를 설정했으며 이 사진 업로드에 동의합니다.
          </label>
        )}
        <Notice>
          위치와 신뢰도는 임의로 입력하지 않습니다. 등록 후 위치 확인을
          이용해주세요.
        </Notice>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={action.busy}>
            {action.busy ? "저장 중…" : "옷 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Detail({ api, member, id, navigate, onClose, onChanged }) {
  const state = useLoad(
    (signal) => api.get(`/garments/${id}`, { signal }),
    [id, api],
  );
  const [edit, setEdit] = useState(false),
    [location, setLocation] = useState(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAction();
  return (
    <>
      {edit && state.data ? (
        <GarmentForm
          api={api}
          member={member}
          garment={state.data}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            state.reload();
            onChanged();
          }}
        />
      ) : (
        <Modal title="옷 상세" onClose={onClose}>
          <Load state={state}>
            {(g) => (
              <>
                <div className="detail-top">
                  <Photo asset={g.image} category={g.category} />
                  <div>
                    <Badge>{g.status}</Badge>
                    <h2>
                      {label(g.color)} {label(g.category)}
                    </h2>
                    <p>{g.material || "소재 미등록"}</p>
                    <p>위치: {g.location_label || "미확인"}</p>
                    <p className="fine">
                      신뢰도{" "}
                      {g.location_confidence === null
                        ? "미확인"
                        : `${Math.round(g.location_confidence * 100)}%`}{" "}
                      · {g.stale ? "오래된 관측" : "최근 관측"}
                    </p>
                    <p className="fine">최근 관측 {time(g.last_seen_at)}</p>
                  </div>
                </div>
                <div className="actions wrap">
                  <button
                    onClick={() =>
                      action.run(async () =>
                        setLocation(
                          await api.send("/garments/locate", {
                            garment_id: g.id,
                          }),
                        ),
                      )
                    }
                  >
                    현재 위치 찾기
                  </button>
                  <button onClick={() => navigate("care", { id: g.id })}>
                    관리 가이드
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      navigate("tryon", {
                        garmentId: g.id,
                        source: "GARMENT_DETAIL",
                      })
                    }
                  >
                    입어보기
                  </button>
                </div>
                {location &&
                  location.items.map((x) => (
                    <Notice key={x.garment_id}>
                      {label(x.status)} · {x.location_label || "위치 미확인"} ·{" "}
                      {x.fallback || `관측 ${time(x.last_seen_at)}`}
                    </Notice>
                  ))}
                <p>케어라벨: {g.care_label || "미등록"}</p>
                {g.owner_id === member.id && (
                  <>
                    <div className="actions wrap">
                      <button onClick={() => setEdit(true)}>정보 수정</button>
                      <button
                        onClick={() =>
                          action.run(async () => {
                            await api.send("/garment-observations", {
                              garment_id: g.id,
                              location_id: g.location_id,
                              sensor_type: "MOCK",
                              confidence: 0.8,
                              observed_at: new Date().toISOString(),
                              source_id: "web-local-qa",
                            });
                            state.reload();
                            onChanged();
                          })
                        }
                        disabled={action.busy}
                      >
                        현재 위치 Mock 관측
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => setConfirmDelete(true)}
                      >
                        옷 삭제
                      </button>
                    </div>
                    {confirmDelete && (
                      <div className="notice">
                        <p>이 옷을 삭제할까요? 기존 이력은 보존됩니다.</p>
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            action.run(async () => {
                              await api.send(
                                `/garments/${g.id}`,
                                undefined,
                                "DELETE",
                                g.version,
                              );
                              onChanged();
                              onClose();
                            })
                          }
                        >
                          삭제 확인
                        </button>
                        <button onClick={() => setConfirmDelete(false)}>
                          유지
                        </button>
                      </div>
                    )}
                  </>
                )}
                <ErrorBox error={action.error} />
              </>
            )}
          </Load>
        </Modal>
      )}
    </>
  );
}
export function Wardrobe({ api, member, navigate, notify, initialId }) {
  const [filters, set] = useState({
      category: "",
      color: "",
      status: "",
      season: "",
    }),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(initialId || null),
    [adding, setAdding] = useState(false);
  const state = useLoad(
    (signal) =>
      api.get("/garments?" + query({ ...filters, limit: 12, offset }), {
        signal,
      }),
    [api, JSON.stringify(filters), offset],
  );
  const change = (key, value) => {
    set({ ...filters, [key]: value });
    setOffset(0);
  };
  return (
    <>
      <SectionHead eyebrow="MY WARDROBE" title="좋아하는 옷을 한눈에.">
        <button onClick={state.reload}>새로고침</button>
        <button className="primary" onClick={() => setAdding(true)}>
          ＋ 옷 등록
        </button>
      </SectionHead>
      <div className="filters">
        <Field label="종류">
          <Select
            values={["", ...categories].map((x) => [
              x,
              x ? label(x) : "전체 종류",
            ])}
            value={filters.category}
            onChange={(e) => change("category", e.target.value)}
          />
        </Field>
        <Field label="색상">
          <Select
            values={["", ...colors].map((x) => [x, x ? label(x) : "전체 색상"])}
            value={filters.color}
            onChange={(e) => change("color", e.target.value)}
          />
        </Field>
        <Field label="상태">
          <Select
            values={[
              "",
              "AVAILABLE",
              "IN_USE",
              "LAUNDRY",
              "CARE",
              "STORED",
              "UNKNOWN",
              "RETIRED",
            ].map((x) => [x, x ? label(x) : "전체 상태"])}
            value={filters.status}
            onChange={(e) => change("status", e.target.value)}
          />
        </Field>
        <Field label="계절">
          <Select
            values={["", "SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"].map(
              (x) => [x, x ? label(x) : "전체 계절"],
            )}
            value={filters.season}
            onChange={(e) => change("season", e.target.value)}
          />
        </Field>
      </div>
      <Load state={state}>
        {(data) => (
          <>
            <div className="block-title">
              <p className="muted">
                총 {data.page.total}벌 · 나의 옷과 공유된 옷
              </p>
            </div>
            {data.items.length ? (
              <div className="grid garments">
                {data.items.map((g) => (
                  <button
                    className="garment-card"
                    key={g.id}
                    onClick={() => setSelected(g.id)}
                  >
                    <Photo asset={g.image} category={g.category} />
                    <div className="garment-meta">
                      <Badge>{g.status}</Badge>
                      <h3>
                        {label(g.color)} {label(g.category)}
                      </h3>
                      <p>
                        {g.location_label || "위치 미확인"}{" "}
                        {g.owner_id !== member.id && "· 가족 공유"}
                      </p>
                      <span className="fine">
                        {g.season_tags.map(label).join(" · ") || "계절 미등록"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="조건에 맞는 옷이 없어요">
                필터를 변경하거나 새로운 옷을 등록해보세요.
              </Empty>
            )}
            <Pager page={data.page} onPage={setOffset} />
          </>
        )}
      </Load>
      {adding && (
        <GarmentForm
          api={api}
          member={member}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            notify("새 옷을 등록했어요.");
            state.reload();
          }}
        />
      )}
      {selected && (
        <Detail
          api={api}
          member={member}
          id={selected}
          navigate={navigate}
          onClose={() => setSelected(null)}
          onChanged={state.reload}
        />
      )}
    </>
  );
}
