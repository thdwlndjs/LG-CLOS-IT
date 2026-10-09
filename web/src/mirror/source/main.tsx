import React, { useSyncExternalStore } from "react";
import { app } from "./appInstance";
import { MirrorPersonProvider } from "./MirrorSceneView";
import { currentSurface, subscribeSurface } from "./surfaceNavigation";
import { createRoot } from "react-dom/client";
import MirrorExperience from "./MirrorExperience";
import "./styles.css";
import "./mirror-scene.css";
import "./review-controls.css";
import "./open-wardrobe.css";
import "./scenario-controls.css";
import "./mirror-experience.css";
function Surface() {
  const path = useSyncExternalStore(subscribeSurface, currentSurface);
  const state = useSyncExternalStore(app.subscribe, app.getState);
  return (
    <MirrorPersonProvider ownerId={state.activeProfileId}>
      {<MirrorExperience />}
    </MirrorPersonProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Surface />
  </React.StrictMode>,
);
