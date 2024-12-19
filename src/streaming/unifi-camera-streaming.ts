import { API, Logging, PlatformAccessory } from "homebridge";
import { RtpPortAllocator } from "homebridge-plugin-utils";
import { readFileSync } from "node:fs";
import os from "node:os";
import { platform } from "node:process";
import { PROTECT_FFMPEG_OPTIONS } from "../settings.js";
import { CameraConfig } from "./camera-config.js";
import { FfmpegCodecs } from "./ffmpeg/protect-ffmpeg-codecs.js";
import { FakePlatform } from "./ffmpeg/protect-ffmpeg.js";
import { ProtectStreamingDelegate } from "./streaming-delegate.js";

export class UnifiCameraStreaming {

    private static _hostSystem: string = '';

    public static setupStreaming(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, api: API, log: Logging): void {
        this.probeHwOs();

        // Update the camera config
        cameraConfig.source = config.unifi.controller_rtsp + '/';
        cameraConfig.debug = config.unifi.debug;

        const videoProcessor = 'ffmpeg';

        const platform: FakePlatform = {
            hostSystem: this._hostSystem,
            api: api,
            hap: api.hap,
            config: {
                hksv: false,
                ffmpegOptions: PROTECT_FFMPEG_OPTIONS,
                videoEncoder: 'libx264',
                videoProcessor
            },
            verboseFfmpeg: true,
            codecSupport: new FfmpegCodecs(videoProcessor, log),
            rtpPorts: new RtpPortAllocator()
        };

        const resolutions: [number, number, number][] = [
            // Width, height, framerate.
            [1920, 1080, 30],
            [1280, 960, 30],
            [1280, 720, 30],
            [1024, 768, 30],
            [640, 480, 30],
            [640, 360, 30],
            [480, 360, 30],
            [480, 270, 30],
            [320, 240, 30],
            [320, 240, 15],   // Apple Watch requires this configuration
            [320, 180, 30]
        ];

        const streamingDelegate = new ProtectStreamingDelegate(platform, cameraConfig.camera, accessory, resolutions, log);

        accessory.context.id = cameraConfig.camera.id;
        accessory.context.motionEnabled = true;
        accessory.context.lastMotionId = null;
        accessory.context.lastMotionIdRepeatCount = 0;

        accessory.configureController(streamingDelegate.controller);
    }

    private static probeHwOs(): void {
        // Start off with a generic identifier.
        this._hostSystem = "generic";

        // Take a look at the platform we're on for an initial hint of what we are.
        switch (platform) {
            // The beloved macOS.
            case "darwin":
                this._hostSystem = "macOS." + (os.cpus()[0].model.includes("Apple") ? "Apple" : "Intel");
                break;

            // The indomitable Linux.
            case "linux":
                // Let's further see if we're a small, but scrappy, Raspberry Pi.
                try {
                    // As of the 4.9 kernel, Raspberry Pi prefers to be identified using this method and has deprecated cpuinfo.
                    const systemId = readFileSync("/sys/firmware/devicetree/base/model", { encoding: "utf8" });
                    // Is it a Pi 4?
                    if (/Raspberry Pi (Compute Module )?4/.test(systemId)) {
                        this._hostSystem = "raspbian";
                    }
                } catch (error) {
                    // We aren't especially concerned with errors here, given we're just trying to ascertain the system information through hints.
                }
                break;

            default:
                // We aren't trying to solve for every system type.
                break;
        }
    }
}
