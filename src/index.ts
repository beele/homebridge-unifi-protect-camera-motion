import {API} from "homebridge";
import {UnifiProtectMotionPlatform} from "./unifi-protect-motion-platform";
import {PLATFORM_NAME, PLUGIN_IDENTIFIER} from "./settings";

export = (api: API) => {
    api.registerPlatform(PLUGIN_IDENTIFIER, PLATFORM_NAME, UnifiProtectMotionPlatform);
}
