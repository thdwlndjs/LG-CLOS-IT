import {createLocalLifeApp,browserLocalLifeStorage,LOCAL_LIFE_STORAGE_KEY} from './localLifeStorage';
import {installReviewedVisualBindings} from './lifeData/visualRepair';
/** User-approved local pack runtime. Remote adapters remain available, without auto-login. */
export const localLifeRuntime=true;
const storage=browserLocalLifeStorage();
const runtime=createLocalLifeApp(storage);
// A private backup precedes a single validated display-only migration, before UI subscribers mount.
export const localVisualRepair=installReviewedVisualBindings(runtime.app,storage,LOCAL_LIFE_STORAGE_KEY);
export const app=runtime.app;
export const localLifeInstallation=runtime.installation;
