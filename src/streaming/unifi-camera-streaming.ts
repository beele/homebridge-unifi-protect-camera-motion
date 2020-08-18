import {UnifiStreamingDelegate} from "./unifi-streaming-delegate";
import {API, Logging, PlatformAccessory} from "homebridge";
import {CameraConfig} from "./camera-config";
import {VideoConfig} from "./video-config";
import {Unifi} from "../unifi/unifi";

export class UnifiCameraStreaming {

    public static setupStreaming(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, api: API, log: Logging): void {
        // Update the camera config
        const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(config.videoConfig));
        // Assign stillImageSource, source and debug (overwrite if they are present from the videoConfig, which should not be the case)
        videoConfigCopy.stillImageSource = '-i http://' + cameraConfig.camera.ip + '/snap.jpeg';
        videoConfigCopy.source = '-rtsp_transport tcp -re -i ' + config.unifi.controller_rtsp + '/' + Unifi.pickHighestQualityAlias(cameraConfig.camera.streams);
        videoConfigCopy.debug = config.unifi.debug;
        cameraConfig.videoConfig = videoConfigCopy;

        const streamingDelegate = new UnifiStreamingDelegate(
            cameraConfig.camera.id, cameraConfig.camera.name,
            log, api, cameraConfig, config.videoProcessor
        );
        UnifiStreamingDelegate.instances.push(streamingDelegate);

        accessory.context.id = cameraConfig.camera.id;
        accessory.context.motionEnabled = true;
        accessory.context.lastMotionId = null;
        accessory.context.lastMotionIdRepeatCount = 0;

        accessory.configureController(streamingDelegate.controller);
    }
}
