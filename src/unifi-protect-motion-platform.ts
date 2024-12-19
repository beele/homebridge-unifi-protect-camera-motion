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
import { UnifiCameraAccessoryInfo } from "./characteristics/unifi-camera-accessory-info.js";
import { UnifiCameraDoorbell } from "./characteristics/unifi-camera-doorbell.js";
import { UnifiCameraMotionSensor } from "./characteristics/unifi-camera-motion-sensor.js";
import { MotionDetector } from "./motion/motion.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { CameraConfig } from "./streaming/camera-config.js";
import { UnifiCameraStreaming } from "./streaming/unifi-camera-streaming.js";
import { Unifi, UnifiCamera, UnifiConfig } from "./unifi/unifi.js";
import { Mqtt } from './utils/mqtt.js';
import { ProtectStreamingDelegate } from './streaming/streaming-delegate.js';

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly hap: HAP;
    public readonly PlatformAccessory: typeof PlatformAccessory;
    private readonly unifiConfig!: UnifiConfig;

    private accessories: Array<PlatformAccessory> = [];
    private unifi: Unifi | undefined;

    private mqtt: Mqtt | undefined;

    constructor(private readonly log: Logging, private readonly config: PlatformConfig, private readonly api: API) {
        this.hap = this.api.hap;
        this.PlatformAccessory = this.api.platformAccessory;

        if (!config || !this.config.unifi) {
            this.log.info('Incorrect plugin configuration!');
            return;
        }

        // Set config defaults
        this.unifiConfig = this.config.unifi as UnifiConfig;
        this.unifiConfig.excluded_cameras = this.unifiConfig.excluded_cameras ? this.unifiConfig.excluded_cameras : [];

        this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching);
    }

    /**
     * This is called by the plugin and is executed after existing accessories have been restored.
     */
    public didFinishLaunching = async (): Promise<void> => {
        if (!this.unifi) {
            this.unifi = new Unifi(this.config.unifi as UnifiConfig, this.log);
            this.unifi.authenticate();
            ProtectStreamingDelegate.unifi = this.unifi;
        }

        let cameras: UnifiCamera[] = [];
        try {
            cameras = await this.filterValidCameras();
            this.log.debug(JSON.stringify(cameras, null, 4));

        } catch (error) {
            this.log.error('Cannot get cameras: ' + error);
            return;
        }

        cameras
            .map((camera: UnifiCamera) => {
                camera.uuid = this.hap.uuid.generate(camera.id);
                const accessory = this.accessories.find((existingAccessory: PlatformAccessory) => existingAccessory.UUID === camera.uuid);
                return { camera, accessory, uuid: camera.uuid }
            })
            .filter((cameraAndAccessory) => {
                // Only keep the cameras that don't have an accessory yet.
                return cameraAndAccessory.accessory === undefined;
            })
            .forEach((cameraAndAccessory) => {
                const camera = cameraAndAccessory.camera;

                // Create new accessories.
                const cameraAccessory = new this.PlatformAccessory!(camera.name, cameraAndAccessory.uuid);
                cameraAccessory.context.cameraConfig = {
                    //Only assign fields here that do not change!
                    uuid: cameraAndAccessory.uuid,
                    name: camera.name,
                    camera: camera
                } as CameraConfig;

                UnifiCameraAccessoryInfo.createAccessoryInfo(camera, cameraAccessory, this.hap);

                this.log.info('Adding ' + cameraAccessory.context.cameraConfig.uuid + ' (' + cameraAccessory.context.cameraConfig.name + ')');
                this.configureAccessory(cameraAccessory);
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
            this.mqtt = new Mqtt(this.config.mqtt_enabled === true ? this.config.mqtt : null, this.log);

            this.accessories.forEach((accessory) => {
                const cameraConfig: CameraConfig = accessory.context.cameraConfig;
                // Update the camera object with the latest info retrieved from the unifi api!
                const updatedCamera = cameras.find((cam: UnifiCamera) => cam.id === accessory.context.cameraConfig.camera.id);
                if (updatedCamera) {
                    cameraConfig.camera = updatedCamera;
                }

                UnifiCameraMotionSensor.setupMotionSensor(cameraConfig, accessory, this.config, this.mqtt!, this.hap, this.log);
                UnifiCameraDoorbell.setupDoorbell(cameraConfig, accessory, this.config, this.hap, this.log);
                UnifiCameraStreaming.setupStreaming(cameraConfig, accessory, this.config, this.api, this.log);
            });

            const motionDetector: MotionDetector = new MotionDetector(this.api, this.config, this.mqtt, this.unifi, cameras, this.log);
            await motionDetector.setupMotionChecking(this.accessories);
            this.log.info('Motion checking setup done!');

        } catch (error) {
            this.log.info('Error during motion checking setup: ' + error);
        }
    }

    /**
     * This is called manually by us for newly added accessories, and is called automatically by Homebridge for accessories that have already been added!
     * @param cameraAccessory 
     */
    public configureAccessory = (cameraAccessory: PlatformAccessory): void => {
        this.log.info('Configuring accessory ' + cameraAccessory.displayName);

        cameraAccessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log.info(cameraAccessory.displayName + ' identified!');
        });

        this.accessories.push(cameraAccessory);
    }

    private filterValidCameras = async (): Promise<UnifiCamera[]> => {
        return ((await this.unifi?.enumerateMotionCameras()) ?? [])
            .filter((camera: UnifiCamera) => {
                console.log(camera);
                if (!(this.config.unifi as UnifiConfig).excluded_cameras.includes(camera.id) && camera.streams.length >= 1) {
                    return camera;
                } else if ((this.config.unifi as UnifiConfig).excluded_cameras.includes(camera.id)) {
                    this.log.info('Camera (' + camera.name + ') excluded by config!');
                    return
                } else {
                    this.log.info('Camera (' + camera.name + ') excluded because is has no available RTSP stream!');
                    return
                }
            });
    }
}
