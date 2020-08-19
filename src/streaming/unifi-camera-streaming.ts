import {UnifiStreamingDelegate} from "./unifi-streaming-delegate";
import {API, Logging, PlatformAccessory} from "homebridge";
import {CameraConfig} from "./camera-config";
import {VideoConfig} from "./video-config";
import {Unifi} from "../unifi/unifi";

export class UnifiCameraStreaming {

    public static setupStreaming(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, api: API, log: Logging): void {
        // Update the camera config
        const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(config.videoConfig));
        if (!videoConfigCopy.vcodec) {
            videoConfigCopy.vcodec = 'copy';
        }
        if (!videoConfigCopy.mapvideo) {
            videoConfigCopy.mapvideo = '0:1';
        }
        if (!videoConfigCopy.mapaudio) {
            videoConfigCopy.mapaudio = '0:0';
        }
        if (!videoConfigCopy.packetSize) {
            videoConfigCopy.packetSize = 564;
        }

        // TODO: Find a way to set the pixel format to yuvj422p
        videoConfigCopy.source = '-re -rtsp_transport tcp -i ' + config.unifi.controller_rtsp + '/' + Unifi.pickHighestQualityAlias(cameraConfig.camera.streams);
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
