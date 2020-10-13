import {UnifiStreamingDelegate} from "./unifi-streaming-delegate";
import {API, Logging, PlatformAccessory} from "homebridge";
import {CameraConfig} from "./camera-config";
import {Unifi} from "../unifi/unifi";

export class UnifiCameraStreaming {

    public static setupStreaming(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, api: API, log: Logging): void {
        // Update the camera config
        cameraConfig.source = config.unifi.controller_rtsp + '/';
        cameraConfig.debug = config.unifi.debug;

        const streamingDelegate = new UnifiStreamingDelegate(cameraConfig.camera, log, api, cameraConfig, config.videoProcessor);

        accessory.context.id = cameraConfig.camera.id;
        accessory.context.motionEnabled = true;
        accessory.context.lastMotionId = null;
        accessory.context.lastMotionIdRepeatCount = 0;

        accessory.configureController(streamingDelegate.controller);
    }
}
