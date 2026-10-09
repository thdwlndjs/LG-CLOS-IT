import { DemoError, stable } from "./repository";
import { REGISTRATION_ASSET } from "./seed";
import type {
  ActionOptions,
  Asset,
  CareGuide,
  Garment,
  OutfitConditions,
  OutfitDraft,
  OutfitItems,
  RegistrationDraft,
  RegistrationField,
  Slot,
  TryOnResult,
} from "./types";

export interface RegistrationAnalysisInput {
  asset: Asset | null;
  ownerId: string;
  draftId: string;
  revision: number;
}
export interface OutfitRecommendationInput {
  conditions: OutfitConditions;
  draft: OutfitDraft;
  garments: Garment[];
}
export interface TryOnInput {
  ownerId: string;
  personAsset: Asset | null;
  outfit: {
    id: string | null;
    draftId: string | null;
    revision: number;
    items: OutfitItems;
    garmentAssets: Record<
      string,
      { id: string | null; version: number | null }
    >;
  };
}
export type RegistrationAnalysisOutput = Partial<
  Pick<RegistrationDraft, RegistrationField>
>;
/** Asynchronous provider boundary. The stage-one implementation only matches prepared local fixtures. */
export interface MockRunner {
  simulate(options?: ActionOptions, signal?: AbortSignal): Promise<void>;
  analyze(
    input: RegistrationAnalysisInput,
    options?: ActionOptions,
  ): Promise<RegistrationAnalysisOutput | null>;
  recommend(
    input: OutfitRecommendationInput,
    options?: ActionOptions,
  ): Promise<OutfitItems | null>;
  careGuide(input: Garment, options?: ActionOptions): Promise<CareGuide>;
  tryOn(
    input: TryOnInput,
    options?: ActionOptions,
    signal?: AbortSignal,
  ): Promise<TryOnResult>;
}
export class PreparedMockRunner implements MockRunner {
  async simulate(
    options: ActionOptions = {},
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, options.delayMs ?? 250));
      signal?.addEventListener("abort", finish, { once: true });
    });
    if (options.fail && !signal?.aborted)
      throw new DemoError(
        "MOCK_FAILURE",
        "개발용 모의 오류입니다. 입력과 초안은 유지됩니다.",
      );
  }
  async analyze(
    input: RegistrationAnalysisInput,
    options?: ActionOptions,
  ): Promise<RegistrationAnalysisOutput | null> {
    await this.simulate(options);
    if (!input.asset || stable(input.asset) !== stable(REGISTRATION_ASSET))
      return null;
    return {
      name: "버건디 니트",
      category: "top",
      color: "버건디",
      features: ["긴소매", "개발용 준비 결과"],
      material: "",
    };
  }
  async recommend(
    { conditions, draft, garments }: OutfitRecommendationInput,
    options?: ActionOptions,
  ): Promise<OutfitItems | null> {
    await this.simulate(options);
    const supported =
      conditions.weather === "sunny" &&
      conditions.temperatureC === 11 &&
      conditions.occasion === "work" &&
      (!draft.items.top || draft.items.top === "g-knit") &&
      Object.entries(draft.items).every(([slot, value]) =>
        slot === "bottom"
          ? ["g-slacks", "g-jeans"].includes(value)
          : (
              {
                top: "g-knit",
                outer: "g-trench",
                bag: "g-bag",
                shoes: "g-shoes",
              } as OutfitItems
            )[slot as Slot] === value,
      ) &&
      Object.entries({
        "g-knit": "gray-sweatshirt",
        "g-slacks": "slacks",
        "g-trench": "trench",
        "g-bag": "bag",
        "g-shoes": "shoes",
        ...(draft.items.bottom === "g-jeans" ? { "g-jeans": "jeans" } : {}),
      }).every(([key, file]) =>
        garments.some(
          (g) =>
            g.id === key &&
            g.ownerId === draft.ownerId &&
            g.asset?.version === 1 &&
            g.asset.id === `asset-${file}` &&
            g.asset.source === "packaged",
        ),
      );
    return supported
      ? {
          top: "g-knit",
          bottom: draft.items.bottom ?? "g-slacks",
          outer: "g-trench",
          bag: "g-bag",
          shoes: "g-shoes",
        }
      : null;
  }
  async careGuide(
    garment: Garment,
    options?: ActionOptions,
  ): Promise<CareGuide> {
    await this.simulate(options);
    const confirmed = garment.provenance.care !== "unconfirmed";
    return {
      garmentId: garment.id,
      title: confirmed ? "보관 안내 · 시연 예시" : "관리 근거 미확인",
      advice: confirmed
        ? `${garment.careNotes} 실제 관리 전 의류 라벨을 확인해 주세요.`
        : "소재와 세탁 라벨 정보가 없습니다. 의류 라벨을 확인한 뒤 직접 관리 내용을 기록할 수 있습니다.",
      source: confirmed ? "prepared-demo" : "unconfirmed",
      actualCareRecorded: false,
    };
  }
  async tryOn(
    _input: TryOnInput,
    options?: ActionOptions,
    signal?: AbortSignal,
  ): Promise<TryOnResult> {
    await this.simulate(options, signal);
    return {
      status: "unavailable",
      message:
        "인물·전체 코디·자산 버전에 일치하는 준비 피팅 결과가 없습니다. 외부 API·카메라·실시간 피팅은 미연결입니다.",
    };
  }
}
