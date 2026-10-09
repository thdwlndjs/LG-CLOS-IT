// These labels identify the unchanged local Seed locations, not live sensor data.
export const demoLocations = {
  "30000000-0000-4000-8000-000000000001": "Main Wardrobe · 주 옷장 (데모)",
  "30000000-0000-4000-8000-000000000002":
    "Seasonal Storage · 계절 보관함 (데모)",
};
export function reasonText(value) {
  if (value === "Available accessible garments")
    return "현재 사용할 수 있는 의류로 구성했어요.";
  if (value === "Rule-based cold-start baseline")
    return "기본 추천 규칙을 적용했어요.";
  if (value.startsWith("Snapshot temperature:"))
    return value
      .replace("Snapshot temperature:", "추천 시점 기온:")
      .replace(" C", "°C");
  if (value.startsWith("Stable diversity selection:"))
    return "서로 다른 코디를 추천하도록 다양성을 고려했어요.";
  if (value.startsWith("Context source:"))
    return value.replace("Context source:", "날씨·일정 데이터 출처:");
  return value;
}
