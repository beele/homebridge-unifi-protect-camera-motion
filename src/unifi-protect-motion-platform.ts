import {
    API,
    APIEvent,
    DynamicPlatformPlugin,
    HAP,
    Logging,
    PlatformAccessory,
    PlatformAccessoryEvent,
    PlatformConfig
} from 'homebridge';
import {Unifi, UnifiCamera} from "./unifi/unifi";
import {UnifiFlows} from "./unifi/unifi-flows";
import {PLATFORM_NAME, PLUGIN_NAME} from "./settings";
import {VideoConfig} from "./streaming/video-config";
import {MotionDetector} from "./motion/motion";
import {UnifiCameraAccessoryInfo} from "./characteristics/unifi-camera-accessory-info";
import {CameraConfig} from "./streaming/camera-config";
import {UnifiCameraMotionSensor} from "./characteristics/unifi-camera-motion-sensor";
import {UnifiCameraDoorbell} from "./characteristics/unifi-camera-doorbell";
import {UnifiCameraStreaming} from "./streaming/unifi-camera-streaming";

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly hap: HAP = this.api.hap;
    public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;

    private readonly accessories: Array<PlatformAccessory> = [];

    private unifi: Unifi;
    private uFlows: UnifiFlows;

    constructor(private readonly log: Logging, private readonly config: PlatformConfig, private readonly api: API) {
        if (!config || !this.config.unifi || !this.config.videoConfig) {
            this.log.info('Incorrect plugin configuration!');
            return;
        }

        //Set config defaults
        this.config.unifi.excluded_cameras = this.config.unifi.excluded_cameras ? this.config.unifi.excluded_cameras : [];

        this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            //Hack to get async functions!
            setTimeout(async () => {
                this.unifi = new Unifi(this.config.unifi, 500, 2, this.log);
                this.uFlows = new UnifiFlows(this.unifi, this.config.unifi, await Unifi.determineEndpointStyle(this.config.unifi.controller, this.log), this.log);
                await this.didFinishLaunching();
            });
        });
    }

    public async didFinishLaunching(): Promise<void> {
        let cameras: UnifiCamera[] = [];
        try {
            cameras = await this.uFlows.enumerateCameras();
            cameras = cameras.filter((camera: UnifiCamera) => {
                if (!this.config.unifi.excluded_cameras.includes(camera.id)) {
                    return camera;
                } else {
                    this.log.info('Camera (' + camera.name + ') excluded by config!');
                }
            });
        } catch (error) {
            this.log.info('Cannot get cameras: ' + error);
        }

        if (cameras.length > 0) {
            cameras.forEach((camera: UnifiCamera) => {
                if (camera.streams.length < 1) {
                    this.log.info('Camera (' + camera.name + ') has no streams, skipping!')
                    return;
                }

                // Camera names must be unique
                const uuid = this.hap.uuid.generate(camera.name);
                camera.uuid = uuid;
                const cameraAccessory = new this.Accessory(camera.name, uuid);

                cameraAccessory.context.cameraConfig = {
                    uuid: uuid,
                    name: camera.name,
                    camera: camera
                } as CameraConfig;

                UnifiCameraAccessoryInfo.createAccessoryInfo(camera, cameraAccessory, this.hap);

                // Only add new cameras that are not cached
                if (!this.accessories.find((x: PlatformAccessory) => x.UUID === uuid)) {
                    this.log.info('Adding ' + cameraAccessory.context.cameraConfig.uuid);
                    this.configureAccessory(cameraAccessory); // abusing the configureAccessory here
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cameraAccessory]);
                }
            });

            // Remove cameras that were not in previous call
            this.accessories.forEach((accessory: PlatformAccessory) => {
                if (!cameras.find((x: UnifiCamera) => x.uuid === accessory.context.cameraConfig.uuid)) {
                    this.log.info('Removing ' + accessory.context.cameraConfig.uuid);
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                }
            });

            try {
                const motionDetector: MotionDetector = new MotionDetector(this.api, this.config, this.uFlows, cameras, this.log);
                await motionDetector.setupMotionChecking(this.accessories);
                this.log.info('Motion checking setup done!');
            } catch (error) {
                this.log.info('Error during motion checking setup: ' + error);
            }
        }
    }

    public configureAccessory(cameraAccessory: PlatformAccessory): void {
        this.log.info('Configuring accessory ' + cameraAccessory.displayName);

        cameraAccessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log.info(cameraAccessory.displayName + ' identified!');
        });

        const cameraConfig: CameraConfig = cameraAccessory.context.cameraConfig;

        //Update the camera config!
        const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(this.config.videoConfig));
        //Assign stillImageSource, source and debug (overwrite if they are present from the videoConfig, which they should not be!)
        videoConfigCopy.stillImageSource = '-i http://' + cameraConfig.camera.ip + '/snap.jpeg';
        videoConfigCopy.source = '-rtsp_transport tcp -re -i ' + this.config.unifi.controller_rtsp + '/' + Unifi.pickHighestQualityAlias(cameraConfig.camera.streams);
        videoConfigCopy.debug = this.config.unifi.debug;
        cameraConfig.videoConfig = videoConfigCopy;

        UnifiCameraMotionSensor.setupMotionSensor(cameraConfig, cameraAccessory, this.config, this.hap, this.log);
        UnifiCameraDoorbell.setupDoorbell(cameraConfig, cameraAccessory, this.config, this.hap, this.log);
        UnifiCameraStreaming.setupStreaming(cameraConfig, cameraAccessory, this.config, this.api, this.log);

        this.accessories.push(cameraAccessory);
    }
}