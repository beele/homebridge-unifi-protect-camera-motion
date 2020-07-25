import {UnifiStreamingDelegate} from "./unifi-streaming-delegate";
import {
    API,
    AudioStreamingCodecType,
    AudioStreamingSamplerate,
    CameraControllerOptions,
    HAP,
    PlatformAccessory
} from "homebridge";
import {CameraStreamingDelegate} from "hap-nodejs/dist/lib/controller/CameraController";
import {CameraConfig} from "./camera-config";

export class UnifiCameraStreaming {

    public static setupStreaming(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, api: API, infoLogger: Function, debugLogger: Function, log: any): void {
        const hap: HAP = api.hap;
        const streamingDelegate = new UnifiStreamingDelegate(
            cameraConfig.camera.id, cameraConfig.camera.name,
            infoLogger, debugLogger,
            api, cameraConfig, log, config.videoProcessor
        );
        UnifiStreamingDelegate.instances.push(streamingDelegate);
        const options: CameraControllerOptions = {
            cameraStreamCount: cameraConfig.videoConfig.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
            delegate: streamingDelegate as unknown as CameraStreamingDelegate,
            streamingOptions: {
                supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
                    resolutions: [
                        [320, 180, 30],
                        [320, 240, 15], // Apple Watch requires this configuration
                        [320, 240, 30],
                        [480, 270, 30],
                        [480, 360, 30],
                        [640, 360, 30],
                        [640, 480, 30],
                        [1280, 720, 30],
                        [1280, 960, 30],
                        [1920, 1080, 30],
                        [1600, 1200, 30],
                    ],
                    codec: {
                        profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
                        levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
                    },
                },
                audio: {
                    codecs: [
                        {
                            type: AudioStreamingCodecType.AAC_ELD,
                            samplerate: AudioStreamingSamplerate.KHZ_16,
                        },
                    ],
                },
            },
        };

        accessory.context.id = cameraConfig.camera.id;
        accessory.context.motionEnabled = true;
        accessory.context.lastMotionId = null;
        accessory.context.lastMotionIdRepeatCount = 0;

        const cameraController = new hap.CameraController(options);
        streamingDelegate.controller = cameraController;
        accessory.configureController(cameraController);
    }
}
