import { DemoApp, emptyUI } from "./core";
/** Both the product mirror and local development tools use the existing store. */
export const app = new DemoApp(undefined, () => ({
  schemaVersion: 1,
  activeProfileId: "signed-out",
  profiles: [{ id: "signed-out", name: "로그인 필요" }],
  garments: [],
  outfits: [],
  events: [],
  registrationDrafts: {},
  outfitDrafts: {},
  ui: { "signed-out": emptyUI() },
  receipts: [],
  intents: {},
  revisionReceipts: {},
}));
