import {VideoConfig} from "./video-config";
import {UnifiCamera} from "../unifi/unifi";

export interface CameraConfig {
    uuid: string;
    name: string;
    camera?: UnifiCamera;
    videoConfig?: VideoConfig;
}