import { MirrorFittingController } from "./mirrorFittingController";
/** Shared in-memory bridge; construction never accesses storage, tokens, camera or a provider. */
export const mirrorFittingSession = new MirrorFittingController();
