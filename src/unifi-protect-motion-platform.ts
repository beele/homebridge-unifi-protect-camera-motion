import {
    API,
    APIEvent,
    AudioStreamingCodecType,
    AudioStreamingSamplerate,
    CameraControllerOptions,
    DynamicPlatformPlugin,
    HAP,
    Logging,
    PlatformAccessory,
    PlatformAccessoryEvent,
    PlatformConfig
} from 'homebridge';
import {Utils} from "./utils/utils";
import {Unifi, UnifiCamera} from "./unifi/unifi";
import {UnifiFlows} from "./unifi/unifi-flows";
import {PLATFORM_NAME, PLUGIN_NAME} from "./settings";
import {VideoConfig} from "./ffmpeg/video-config";
import {MotionDetector} from "./motion/motion";
import {UnifiStreamingDelegate} from "./unifi/UnifiStreamingDelegate";
import {CameraStreamingDelegate} from "hap-nodejs/dist/lib/controller/CameraController";

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly hap: HAP = this.api.hap;
    public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;
    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;

    private readonly accessories: Array<PlatformAccessory> = [];

    private readonly infoLogger: Function;
    private readonly debugLogger: Function;

    private unifi: Unifi;
    private uFlows: UnifiFlows;

    constructor(private readonly log: Logging, private readonly config: PlatformConfig, private readonly api: API) {
        this.infoLogger = Utils.createLogger(this.log, true, false);
        if (!config || !this.config.unifi || !this.config.videoConfig) {
            this.infoLogger('Incorrect plugin configuration!');
            return;
        }
        this.debugLogger = Utils.createLogger(this.log, false, this.config.unifi.debug);

        //Set config defaults
        this.config.unifi.excluded_cameras = this.config.unifi.excluded_cameras ? this.config.unifi.excluded_cameras : [];

        this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            //Hack to get async functions!
            setTimeout(async () => {
                this.unifi = new Unifi(this.config.unifi, 500, 2, this.infoLogger);
                this.uFlows = new UnifiFlows(this.unifi, this.config.unifi, await Unifi.determineEndpointStyle(this.config.unifi.controller, this.infoLogger), this.debugLogger);
                await this.didFinishLaunching();
            });
        });
    }

    public configureAccessory(cameraAccessory: PlatformAccessory): void {
        this.infoLogger('Configuring accessory ' + cameraAccessory.displayName);

        cameraAccessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.infoLogger(cameraAccessory.displayName + ' identified!');
        });

        const cameraConfig = cameraAccessory.context.cameraConfig;

        //Update the camera config!
        const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(this.config.videoConfig));
        //Assign stillImageSource, source and debug (overwrite if they are present from the videoConfig, which they should not be!)
        videoConfigCopy.stillImageSource = '-i http://' + cameraConfig.camera.ip + '/snap.jpeg';
        videoConfigCopy.source = '-rtsp_transport tcp -re -i ' + this.config.unifi.controller_rtsp + '/' + Unifi.pickHighestQualityAlias(cameraConfig.camera.streams);

        videoConfigCopy.debug = this.config.unifi.debug;
        cameraConfig.videoConfig = videoConfigCopy;

        //TODO: Refactor
        cameraAccessory.context.id = cameraConfig.camera.id;
        cameraAccessory.context.motionEnabled = true;
        cameraAccessory.context.lastMotionId = null;
        cameraAccessory.context.lastMotionIdRepeatCount = 0;

        const motion = cameraAccessory.getService(this.hap.Service.MotionSensor);
        const motionSwitch = cameraAccessory.getServiceById(this.hap.Service.Switch, 'MotionTrigger');
        if (motion) {
            cameraAccessory.removeService(motion);
        }
        if (motionSwitch) {
            cameraAccessory.removeService(motionSwitch);
        }

        cameraAccessory.addService(new this.Service.MotionSensor(cameraConfig.name + ' Motion sensor'));
        cameraAccessory.addService(new this.Service.Switch(cameraConfig.name + ' Motion enabled', 'MotionTrigger'));
        cameraAccessory
            .getService(this.Service.Switch)
            .getCharacteristic(this.Characteristic.On)
            .on(this.api.hap.CharacteristicEventTypes.GET, (callback: Function) => {
                callback(null, cameraAccessory.context.motionEnabled);
            })
            .on(this.api.hap.CharacteristicEventTypes.SET, (value: boolean, callback: Function) => {
                cameraAccessory.context.motionEnabled = value;
                this.infoLogger('Motion detection for ' + cameraConfig.name + ' has been turned ' + (cameraAccessory.context.motionEnabled ? 'ON' : 'OFF'));
                callback();
            });

        const streamingDelegate = new UnifiStreamingDelegate(this.hap, cameraConfig, this.log, this.config.videoProcessor);
        //streamingDelegate.handleSnapshotRequest(null, null);

        const options: CameraControllerOptions = {
            cameraStreamCount: cameraConfig.videoConfig.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
            delegate: streamingDelegate as CameraStreamingDelegate,
            streamingOptions: {
                supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
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
                        profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
                        levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0],
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

        const cameraController = new this.hap.CameraController(options);
        streamingDelegate.controller = cameraController;
        cameraAccessory.configureController(cameraController);
        this.accessories.push(cameraAccessory);
    }

    public async didFinishLaunching(): Promise<void> {
        let cameras: UnifiCamera[] = [];
        try {
            cameras = await this.uFlows.enumerateCameras();
            cameras = cameras.filter((camera: UnifiCamera) => {
                if (!this.config.unifi.excluded_cameras.includes(camera.id)) {
                    return camera;
                } else {
                    this.infoLogger('Camera (' + camera.name + ') excluded by config!');
                }
            });
        } catch (error) {
            this.infoLogger('Cannot get cameras: ' + error);
        }

        if (cameras.length > 0) {
            cameras.forEach((camera: UnifiCamera) => {
                if (camera.streams.length < 1) {
                    this.infoLogger('Camera (' + camera.name + ') has no streams, skipping!')
                    return;
                }

                // Camera names must be unique
                const uuid = this.hap.uuid.generate(camera.name);
                camera.uuid = uuid;
                const cameraAccessory = new this.Accessory(camera.name, uuid);

                cameraAccessory.context.cameraConfig = {
                    uuid: uuid,
                    name: camera.name,
                    camera
                };

                const cameraAccessoryInfo = cameraAccessory.getService(this.hap.Service.AccessoryInformation);
                if (cameraAccessoryInfo) {
                    cameraAccessoryInfo.setCharacteristic(this.hap.Characteristic.Manufacturer, 'Ubiquity');
                    if (camera.type) {
                        cameraAccessoryInfo.setCharacteristic(this.hap.Characteristic.Model, camera.type);
                    }
                    if (camera.mac) {
                        cameraAccessoryInfo.setCharacteristic(this.hap.Characteristic.SerialNumber, camera.mac);
                    }
                    if (camera.firmware) {
                        cameraAccessoryInfo.setCharacteristic(this.hap.Characteristic.FirmwareRevision, camera.firmware);
                    }
                }

                // Only add new cameras that are not cached
                if (!this.accessories.find((x: PlatformAccessory) => x.UUID === uuid)) {
                    this.infoLogger('Adding ' + cameraAccessory.context.cameraConfig.uuid);
                    this.configureAccessory(cameraAccessory); // abusing the configureAccessory here
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cameraAccessory]);
                }
            });

            // Remove cameras that were not in previous call
            this.accessories.forEach((accessory: PlatformAccessory) => {
                if (!cameras.find((x: UnifiCamera) => x.uuid === accessory.context.cameraConfig.uuid)) {
                    this.infoLogger('Removing ' + accessory.context.cameraConfig.uuid);
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                }
            });

            try {
                const motionDetector: MotionDetector = new MotionDetector(this.api, this.config, this.uFlows, cameras, this.infoLogger, this.debugLogger);
                await motionDetector.setupMotionChecking(this.accessories);
                this.infoLogger('Motion checking setup done!');
            } catch (error) {
                this.infoLogger('Error during motion checking setup: ' + error);
            }
        }
    }
}