import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Asset, Garment } from "./core";
import { Icon } from "./Icons";
import { FittingStreamVideo } from "./FittingStreamVideo";
import { PACK_PERSON, PACK_PROFILE_ID } from "./wardrobePack";
import type { CompartmentDefinition, MirrorPerson } from "./mirrorScene";
import { LAYOUT_CONFIG, getLayoutCompartment } from "./layoutConfig";

// All dimensions, compartment IDs and legacy aliases are owned by this display-only config.
export { MIRROR_COMPARTMENTS, MIRROR_BINDINGS } from "./layoutConfig";

export const PERSON_REFERENCES: (MirrorPerson & {
  label: string;
  reference: string;
})[] = [
  { ...PACK_PERSON, reference: "팩 예시 인물 · 생성된 정적 시연 사진" },
  {
    id: "libfile_b7430c83d5fc8191b65e79fb6bd328a7",
    version: 1,
    url: null,
    label: "인물 1 · 여성 참조",
    reference: "최신 여성 인물 원본 연결 대기",
  },
  {
    id: "libfile_8932c1d171f48191b619f7ad9e21c59a",
    version: 1,
    url: null,
    label: "인물 2 · 남성 참조",
    reference: "최신 남성 인물 원본 연결 대기",
  },
];

export type SceneMedia =
  | { url: string; kind: "image" | "video"; label: string }
  | { kind: "stream"; stream: MediaStream; label: string };
type CabinetCell = CompartmentDefinition & {
  garments: Garment[];
  inspectedGarmentId: string | null;
  outfitGarmentIds: string[];
  guidedGarmentIds: string[];
  ledOn: boolean;
  ledLabel: string;
};

function fabricColor(color: string) {
  const shades: [string, string][] = [
    ["화이트", "#eee9df"],
    ["아이보리", "#d7c9af"],
    ["크림", "#e0d2b8"],
    ["베이지", "#bfa486"],
    ["카멜", "#a57b57"],
    ["브라운", "#765742"],
    ["블랙", "#292b2e"],
    ["차콜", "#525456"],
    ["그레이", "#a1a09b"],
    ["네이비", "#333f50"],
    ["인디고", "#3d5367"],
    ["블루", "#899ba9"],
    ["올리브", "#737663"],
    ["그린", "#647668"],
    ["버건디", "#73484a"],
    ["핑크", "#bc9a95"],
  ];
  return shades.find(([name]) => color.includes(name))?.[1] ?? "#b9af9f";
}

function Hanger() {
  return (
    <svg className="garment-hanger" viewBox="0 0 120 35" aria-hidden="true">
      <path
        d="M56 10c0-8 10-8 10-2 0 4-6 5-6 9M60 16 11 31q-3 2 1 2h96q4 0 1-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StorageCabinet({
  side,
  cells,
  onSelect,
  photo,
  simulated = false,
}: {
  simulated?: boolean;
  side: "left" | "right";
  cells: CabinetCell[];
  onSelect: (id: string) => void;
  photo: (asset: Asset | null, name: string) => React.ReactNode;
}) {
  const cabinet = useRef<HTMLElement>(null);
  const guidance = cells
    .filter((c) => c.side === side)
    .map((c) => c.guidedGarmentIds.join(","))
    .join("|");
  useEffect(() => {
    for (const item of cabinet.current?.querySelectorAll<HTMLElement>(
      ".stored-garment.guided",
    ) ?? []) {
      const scroller = item.closest<HTMLElement>(".cell-clothes");
      if (scroller) {
        scroller.scrollLeft = Math.max(
          0,
          item.offsetLeft -
            scroller.offsetLeft -
            (scroller.clientWidth - item.clientWidth) / 2,
        );
        scroller.scrollTop = Math.max(0, item.offsetTop - scroller.offsetTop);
      }
    }
  }, [guidance]);
  const columns = LAYOUT_CONFIG.columns.filter(
    (column) => column.side === side,
  );
  return (
    <aside
      ref={cabinet}
      className={`storage-cabinet storage-${side} open-storage ${simulated ? "pack-cabinet" : ""}`}
      aria-label={
        side === "left"
          ? "왼쪽 열린 수납부 · 긴 옷과 상하단 행거"
          : "오른쪽 열린 수납부 · 접은 옷 선반 두 열"
      }
    >
      <header>
        <span>
          {side === "left" ? "HANGING WARDROBE" : "FOLDED COLLECTION"}
        </span>
        <small>
          {side === "left" ? "긴 옷 / 상·하단 행거" : "접어 보관하는 상·하의"}
        </small>
      </header>
      <div className="storage-columns">
        {columns.map((column) => {
          const columnCells = column.compartmentIds.flatMap((id) => {
            const cell = cells.find((c) => c.id === id);
            return cell ? [cell] : [];
          });
          return (
            <div
              className={`storage-column column-${column.kind}`}
              key={column.id}
              data-layout-column={column.id}
              aria-label={column.label}
            >
              <div className="column-heading">
                <span>{column.label}</span>
                <i aria-hidden="true" />
              </div>
              <div
                className="storage-cells"
                style={{
                  gridTemplateRows: columnCells
                    .map(
                      (c) =>
                        `${(getLayoutCompartment(c.id)?.geometry.height ?? 1) * 100}fr`,
                    )
                    .join(" "),
                }}
              >
                {columnCells.map((c) => {
                  const definition = getLayoutCompartment(c.id);
                  const kind = definition?.type ?? "shelf";
                  const hanging =
                    kind.includes("hanger") || kind.includes("hanging");
                  const drawer = kind.includes("drawer");
                  return (
                    <section
                      key={c.id}
                      data-compartment-id={c.id}
                      data-storage-type={kind}
                      data-led={c.ledOn ? "on" : "off"}
                      className={`storage-cell ${hanging ? "hanging-cell" : drawer ? "drawer-cell" : "shelf-cell folded-cell"} ${kind === "long-hanger" ? "long-hanging-cell" : ""} ${c.ledOn ? "led-active" : ""} ${drawer && !c.garments.length ? "closed-drawer" : ""}`}
                      aria-label={`${c.label}${c.ledOn ? " · LED 켜짐" : ""}`}
                    >
                      <div
                        className="storage-led"
                        data-led-anchor={c.id}
                        aria-hidden="true"
                      >
                        <i />
                        <i />
                      </div>
                      <div className="cell-label">
                        <span>{c.label}</span>
                        <span>
                          {c.garments.length
                            ? `${c.garments.length}벌${hanging && c.garments.length > 1 ? " · ↔" : ""}`
                            : "미배치"}
                        </span>
                      </div>
                      {drawer && !c.garments.length ? (
                        <div
                          className={`drawer-front ${kind === "drawer-stack" ? "drawer-stack" : ""}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </div>
                      ) : (
                        <div className="cell-clothes">
                          {c.garments.map((g) => (
                            <button
                              type="button"
                              key={g.id}
                              data-cabinet-garment-id={g.id}
                              data-location-ref={
                                simulated ? `시연:${c.id}` : g.location
                              }
                              data-real-location-ref={g.location}
                              data-garment-category={g.category}
                              aria-label={`${c.label}의 ${g.name} 위치 안내`}
                              aria-pressed={c.guidedGarmentIds.includes(g.id)}
                              className={`stored-garment ${hanging ? "hanging-garment" : "folded-garment"} ${c.inspectedGarmentId === g.id ? "inspected" : ""} ${c.guidedGarmentIds.includes(g.id) ? "guided" : ""}`}
                              style={
                                {
                                  "--fabric-color": fabricColor(g.color),
                                } as CSSProperties
                              }
                              onClick={() => onSelect(g.id)}
                            >
                              <div className="stored-photo">
                                {hanging && <Hanger />}
                                {!hanging && (
                                  <span
                                    className="folded-edge"
                                    aria-hidden="true"
                                  />
                                )}
                                {photo(g.asset, g.name)}
                                <i className="garment-led" aria-hidden="true" />
                              </div>
                              <span>{g.name}</span>
                              {c.outfitGarmentIds.includes(g.id) && (
                                <small className="in-look">현재 코디</small>
                              )}
                            </button>
                          ))}
                          {!c.garments.length && (
                            <p className="empty-cell">등록된 옷 없음</p>
                          )}
                        </div>
                      )}
                      {c.ledOn && (
                        <div className="cell-guidance" aria-live="polite">
                          <span />
                          위치 안내 · LED 시뮬레이션
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        {simulated
          ? "시연 배치 · 실물 위치·치수 미확정"
          : "LED 시뮬레이션 · 수납 구조·실물 연결 미검증"}
      </footer>
    </aside>
  );
}

function defaultPerson(ownerId: string) {
  if (ownerId.startsWith("local:scprep-20261009-v1:profile:"))
    return {
      id: `${ownerId}:person:pending`,
      version: 1,
      url: null,
      label: "인물 자료 미연결",
      reference: "이 프로필의 승인된 인물 사진 연결 대기",
    };
  return ownerId === PACK_PROFILE_ID
    ? PERSON_REFERENCES[0]
    : PERSON_REFERENCES[1];
}
function useMirrorPersonState(ownerId: string) {
  const [selectedId, setSelectedId] = useState(defaultPerson(ownerId).id);
  const [localPerson, setLocalPerson] = useState<
    (MirrorPerson & { label: string; ownerId: string }) | null
  >(null);
  const [personMessage, setPersonMessage] = useState("");
  const localUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const owner = useRef(ownerId);
  owner.current = ownerId;
  useEffect(
    () => () => {
      generation.current++;
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    },
    [],
  );
  useEffect(() => {
    generation.current++;
    setPersonMessage("");
    setSelectedId(defaultPerson(ownerId).id);
  }, [ownerId]);
  const person =
    localPerson?.ownerId === ownerId && selectedId === localPerson.id
      ? localPerson
      : (PERSON_REFERENCES.find((p) => p.id === selectedId) ??
        defaultPerson(ownerId));
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setPersonMessage("PNG·JPEG·WebP, 10MB 이하 인물 사진을 선택해 주세요.");
      return;
    }
    const token = ++generation.current,
      currentOwner = owner.current,
      url = URL.createObjectURL(file),
      probe = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        probe.onload = () => resolve();
        probe.onerror = reject;
        probe.src = url;
      });
      if (token !== generation.current || owner.current !== currentOwner) {
        URL.revokeObjectURL(url);
        return;
      }
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      localUrl.current = url;
      const uploaded = {
        id: `local-person-${crypto.randomUUID()}`,
        version: 1,
        url,
        label: "직접 선택한 인물 사진",
        ownerId: currentOwner,
      };
      setLocalPerson(uploaded);
      setSelectedId(uploaded.id);
      setPersonMessage(
        "사진 원본 비율로 표시합니다. 외부 전송·카메라 사용 없음. 새로고침 후 다시 선택해 주세요.",
      );
    } catch {
      URL.revokeObjectURL(url);
      setPersonMessage("사진을 열지 못했어요. 현재 인물 선택은 유지합니다.");
    }
  };
  return {
    person,
    selectedId,
    setSelectedId,
    upload,
    personMessage,
    localPerson: localPerson?.ownerId === ownerId ? localPerson : null,
  };
}

const MirrorPersonContext = createContext<{
  ownerId: string;
  value: ReturnType<typeof useMirrorPersonState>;
} | null>(null);
export function MirrorPersonProvider({
  ownerId,
  children,
}: {
  ownerId: string;
  children: ReactNode;
}) {
  const value = useMirrorPersonState(ownerId);
  return (
    <MirrorPersonContext.Provider value={{ ownerId, value }}>
      {children}
    </MirrorPersonContext.Provider>
  );
}
export function useMirrorPerson(ownerId: string) {
  const context = useContext(MirrorPersonContext);
  if (!context || context.ownerId !== ownerId)
    throw new Error("현재 사용자의 인물 맥락을 확인하지 못했습니다.");
  return context.value;
}

export function MirrorPersonStage({
  person,
  media,
  message,
}: {
  person: MirrorPerson & { label?: string };
  media: SceneMedia | null;
  message: string;
}) {
  return (
    <section
      className="person-stage"
      aria-label="중앙 인물 미러"
      data-person-id={person.id}
      data-person-version={person.version}
      data-fitting-applied={media ? "true" : "false"}
    >
      <div className="mirror-surface" aria-hidden="true" />
      {media ? (
        media.kind === "stream" ? (
          <FittingStreamVideo stream={media.stream} label={media.label} />
        ) : media.kind === "video" ? (
          <video
            className="person-media"
            src={media.url}
            controls
            playsInline
            aria-label={media.label}
          />
        ) : (
          <img className="person-media" src={media.url} alt={media.label} />
        )
      ) : person.url ? (
        <img
          className="person-media"
          src={person.url}
          alt={`${person.label ?? "선택 인물"} · 사진 기반 · 선택 코디 미적용`}
        />
      ) : (
        <div className="person-unavailable">
          <Icon name="user" size={40} />
          <strong>인물 사진 연결 대기</strong>
          <p>최신 인물 원본이 필요해요.</p>
          <p>
            상단에서 사진을 직접 선택하면
            <br />
            메뉴를 바꿔도 이 자리에 유지돼요.
          </p>
          <small>이전 인물로 임의 대체하지 않았어요.</small>
        </div>
      )}
      <div className="person-caption">
        <span>
          {media
            ? media.label
            : person.url
              ? "사진 기반 인물"
              : "인물 자산 미연결"}
        </span>
        <p role="status">{message}</p>
      </div>
    </section>
  );
}
