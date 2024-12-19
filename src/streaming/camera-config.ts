import {UnifiCamera} from "../unifi/unifi.js";

export interface CameraConfig {
    uuid: string;
    name: string;
    camera: UnifiCamera;
    source: string;
    debug: boolean;
}
