import {API} from "homebridge";
import {PLATFORM_NAME, PLUGIN_IDENTIFIER} from "./settings.js";
import { UnifiProtectMotionPlatform } from "./unifi-protect-motion-platform.js";

export default (api: API) => {
    api.registerPlatform(PLUGIN_IDENTIFIER, PLATFORM_NAME, UnifiProtectMotionPlatform);
}
