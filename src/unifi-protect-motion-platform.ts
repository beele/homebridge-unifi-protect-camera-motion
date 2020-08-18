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
import {MotionDetector} from "./motion/motion";
import {UnifiCameraAccessoryInfo} from "./characteristics/unifi-camera-accessory-info";
import {CameraConfig} from "./streaming/camera-config";
import {UnifiCameraMotionSensor} from "./characteristics/unifi-camera-motion-sensor";
import {UnifiCameraDoorbell} from "./characteristics/unifi-camera-doorbell";
import {UnifiCameraStreaming} from "./streaming/unifi-camera-streaming";

const pathToFfmpeg = require('ffmpeg-for-homebridge');

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly hap: HAP = this.api.hap;
    public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;

    private accessories: Array<PlatformAccessory> = [];
    private unifi: Unifi;
    private uFlows: UnifiFlows;

    constructor(private readonly log: Logging, private readonly config: PlatformConfig, private readonly api: API) {
        if (!config || !this.config.unifi || !this.config.videoConfig) {
            this.log.info('Incorrect plugin configuration!');
            return;
        }

        //Set config defaults
        this.config.unifi.excluded_cameras = this.config.unifi.excluded_cameras ? this.config.unifi.excluded_cameras : [];

        log.info('VIDEO PROCESSOR: ' + (this.config.videoConfig.videoProcessor || pathToFfmpeg || 'ffmpeg'));

        this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            //Hack to get async functions!
            setTimeout(async () => {
                try {
                    this.unifi = new Unifi(this.config.unifi, 500, 2, this.log);
                    this.uFlows = new UnifiFlows(this.unifi, this.config.unifi, await Unifi.determineEndpointStyle(this.config.unifi.controller, this.log), this.log);
                    await this.didFinishLaunching();
                } catch (error) {
                    this.log.error(error);
                }
            });
        });
    }

    // This is called by us and is executed after existing accessories have been restored.
    public async didFinishLaunching(): Promise<void> {
        let cameras: UnifiCamera[] = [];
        try {
            cameras = await this.filterValidCameras();
        } catch (error) {
            this.log.info('Cannot get cameras: ' + error);
        }

        cameras
            .map((camera: UnifiCamera) => {
                camera.uuid = this.hap.uuid.generate(camera.id);
                const accessory: PlatformAccessory = this.accessories.find((existingAccessory: PlatformAccessory) => existingAccessory.UUID === camera.uuid);
                return {camera, accessory}
            })
            .filter((cameraAndAccessory: { camera: UnifiCamera; accessory: PlatformAccessory }) => {
                return cameraAndAccessory.accessory === undefined;
            })
            .map((cameraAndAccessory: { camera: UnifiCamera; accessory: PlatformAccessory }) => {
                return cameraAndAccessory.camera;
            })
            .forEach((camera: UnifiCamera) => {
                const cameraAccessory = new this.Accessory(camera.name, camera.uuid);
                cameraAccessory.context.cameraConfig = {
                    //Only assign fields here that do not change!
                    uuid: camera.uuid,
                    name: camera.name,
                    camera: camera
                } as CameraConfig;

                UnifiCameraAccessoryInfo.createAccessoryInfo(camera, cameraAccessory, this.hap);

                this.log.info('Adding ' + cameraAccessory.context.cameraConfig.uuid + ' (' + cameraAccessory.context.cameraConfig.name + ')');
                this.configureAccessory(cameraAccessory); // abusing the configureAccessory here
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cameraAccessory]);
            });

        // Remove cameras that were not in previous call
        this.accessories = this.accessories.filter((accessory: PlatformAccessory) => {
            if (!cameras.find((x: UnifiCamera) => x.uuid === accessory.context.cameraConfig.uuid)) {
                this.log.info('Removing ' + accessory.context.cameraConfig.uuid + ' (' + accessory.context.cameraConfig.name + ')');
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            } else {
                return accessory;
            }
        });

        // Set up the motion detection for all valid accessories
        try {
            this.accessories.forEach((accessory) => {
                const cameraConfig: CameraConfig = accessory.context.cameraConfig;
                // Update the camera object
                cameraConfig.camera = cameras.find((cam: UnifiCamera) => cam.id === accessory.context.cameraConfig.camera.id);

                UnifiCameraMotionSensor.setupMotionSensor(cameraConfig, accessory, this.config, this.hap, this.log);
                UnifiCameraDoorbell.setupDoorbell(cameraConfig, accessory, this.config, this.hap, this.log);
                UnifiCameraStreaming.setupStreaming(cameraConfig, accessory, this.config, this.api, this.log);
            });

            const motionDetector: MotionDetector = new MotionDetector(this.api, this.config, this.uFlows, cameras, this.log);
            await motionDetector.setupMotionChecking(this.accessories);
            this.log.info('Motion checking setup done!');
        } catch (error) {
            this.log.info('Error during motion checking setup: ' + error);
        }
    }

    // This is called manually by us for newly added accessories, and is called automatically by Homebridge for accessories that have already been added!
    public configureAccessory(cameraAccessory: PlatformAccessory): void {
        this.log.info('Configuring accessory ' + cameraAccessory.displayName);

        cameraAccessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log.info(cameraAccessory.displayName + ' identified!');
        });

        this.accessories.push(cameraAccessory);
    }

    private async filterValidCameras(): Promise<UnifiCamera[]> {
        return (await this.uFlows.enumerateCameras()).filter((camera: UnifiCamera) => {
            if (!this.config.unifi.excluded_cameras.includes(camera.id) && camera.streams.length >= 1) {
                return camera;
            } else {
                if (this.config.unifi.excluded_cameras.includes(camera.id)) {
                    this.log.info('Camera (' + camera.name + ') excluded by config!');
                } else if (camera.streams.length < 1) {
                    this.log.info('Camera (' + camera.name + ') excluded because is has no available RTSP stream!');
                }
            }
        });
    }
}