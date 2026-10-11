import type { DemoEvent, Garment, Outfit, OutfitItems } from "./core/types";

/** Up to three distinct, registered-item compositions; no invented items or copies. */
export function homeDemoChoices(
  garments: readonly Garment[],
  owner: string,
  date: string,
) {
  // Caller already supplies device-accessible family inventory. Keep that contract.
  garments = garments.filter(g => g.serverStatus === undefined || g.serverStatus === "AVAILABLE");
  const result: { outfit: Outfit; reasons: string[] }[] = [];
  const seen = new Set<string>();
  for (
    let offset = 0;
    offset < garments.length && result.length < 3;
    offset++
  ) {
    const rotated = [...garments.slice(offset), ...garments.slice(0, offset)];
    // Try different tops/bottoms while preserving deterministic Mock provenance.
    const top = rotated.find((g) => g.category === "top" && g.asset?.url);
    const bottom = rotated.find((g) => g.category === "bottom" && g.asset?.url);
    const subset = rotated.filter(
      (g) =>
        (g.category !== "top" || g.id === top?.id) &&
        (g.category !== "bottom" || g.id === bottom?.id),
    );
    const candidate = winterHomeScenario(subset, owner, date);
    if (!candidate.outfit) continue;
    const key = Object.entries(candidate.outfit.items)
      .sort()
      .map(([slot, id]) => `${slot}:${id}`)
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      outfit: {
        ...candidate.outfit,
        id: `${candidate.outfit.id}:${result.length}`,
      },
      reasons: candidate.reasons,
    });
  }
  return result;
}

/** Display-only scenario. Never insert these counts or measurements into app/DB state. */
export function winterHomeScenario(
  garments: readonly Garment[],
  owner: string,
  date: string,
) {
  garments = garments.filter(g => g.serverStatus === undefined || g.serverStatus === "AVAILABLE");
  const usage = garments.map((g) => ({
    garmentId: g.id,
    name: g.name,
    count: [...g.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5,
  }));
  const leastUsed = (category: Garment["category"]) =>
    garments
      .filter((g) => g.category === category && !!g.asset?.url)
      .sort(
        (a, b) =>
          usage.find((u) => u.garmentId === a.id)!.count -
            usage.find((u) => u.garmentId === b.id)!.count ||
          a.id.localeCompare(b.id),
      )[0];
  const items: OutfitItems = {};
  const top = leastUsed("top"),
    bottom = leastUsed("bottom"),
    dress = leastUsed("dress"),
    outer = leastUsed("outer");
  if (top && bottom) {
    items.top = top.id;
    items.bottom = bottom.id;
  } else if (dress) items.dress = dress.id;
  if (outer) items.outer = outer.id;
  const accessory = leastUsed("accessory"), shoes = leastUsed("shoes");
  if (accessory) items.accessory = accessory.id;
  if (shoes) items.shoes = shoes.id;
  const selected = garments.filter((g) => Object.values(items).includes(g.id));
  const outfit: Outfit | null =
    (top && bottom) || dress
      ? {
          id: `home-demo:${owner}:${date}`,
          ownerId: owner,
          name: "기온 하락에 대비한 레이어드 코디",
          items,
          revision: 1,
          assetIds: Object.fromEntries(
            selected.map((g) => [g.id, g.asset?.id ?? null]),
          ),
          assetVersions: Object.fromEntries(
            selected.map((g) => [g.id, g.asset?.version ?? 0]),
          ),
        }
      : null;
  const rooms = [
    { name: "옷장", humidity: 58, temperature: 22 },
    { name: "첫 번째 방", humidity: 72, temperature: 23 },
    { name: "두 번째 방", humidity: 45, temperature: 20 },
  ];
  const candidates = rooms.filter(
    (r) => r.humidity >= 40 && r.humidity <= 55 && r.temperature <= 25,
  );
  const storageRoom =
    candidates.sort(
      (a, b) => Math.abs(a.humidity - 45) - Math.abs(b.humidity - 45),
    )[0] ?? null;
  return {
    outfit,
    usage,
    rooms,
    storageRoom,
    todayTemperature: 16,
    nextWeekTemperature: 7,
    reasons: [
      "시연 예보: 다음 주 기온이 16°C에서 7°C로 내려갑니다.",
      "최근 7일 사용 횟수가 낮은 의류를 우선 조합했습니다. 사용 횟수는 Mock입니다.",
      outer
        ? "겉옷을 더한 구성입니다. 실제 보온성·착용 가능 상태는 확인하세요."
        : "겉옷 사진이 없어 추가하지 않았습니다.",
    ],
  };
}

export function confirmedHomeUsage(
  events: readonly DemoEvent[],
  owner: string,
  garments: readonly Garment[],
) {
  const ids = new Set(garments.map((g) => g.id));
  const wear = events.filter(
    (e) =>
      e.ownerId === owner &&
      e.kind === "wear" &&
      !e.voided &&
      e.inputSource !== "scenario_fixture",
  );
  return {
    wearRecords: wear.length,
    careRecords: events.filter(
      (e) =>
        e.ownerId === owner &&
        e.kind === "care" &&
        !e.voided &&
        e.inputSource !== "scenario_fixture",
    ).length,
    perGarment: garments.map((g) => ({
      garmentId: g.id,
      name: g.name,
      count: wear.filter(
        (e) =>
          e.garmentId === g.id ||
          e.garmentIds?.filter((id) => ids.has(id)).includes(g.id),
      ).length,
    })),
  };
}
