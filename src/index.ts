import {API} from "homebridge";
import {UnifiProtectMotionPlatform} from "./unifi-protect-motion-platform";
import {PLATFORM_NAME} from "./settings";
import {PLUGIN_NAME} from "./settings";

export = (api: API) => {
    api.registerPlatform("PLUGIN_NAME", PLATFORM_NAME, UnifiProtectMotionPlatform);
}
