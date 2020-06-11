import {API} from "homebridge";
import {UnifiProtectMotionPlatform} from "./unifi-protect-motion-platform";
import {PLATFORM_NAME} from "./settings";

export = (api: API) => {
    api.registerPlatform("homebridge-unifi-protect-camera-motion", PLATFORM_NAME, UnifiProtectMotionPlatform);
}
