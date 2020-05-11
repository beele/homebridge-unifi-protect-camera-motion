import {API, APIEvent, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Categories} from "homebridge";
import {Utils} from "./utils/utils";
import {Unifi} from "./unifi/unifi";
import {UnifiFlows} from "./unifi/unifi-flows";
import {MotionDetector} from "./motion/motion";
import {PLUGIN_NAME} from "./settings";
import {VideoConfig} from "./ffmpeg/video-config";

const FFMPEG = require('homebridge-camera-ffmpeg/ffmpeg.js').FFMPEG;

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;

    constructor(
        public readonly logger: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            //Hack to get async functions!
            setTimeout(async () => {
                this.discoverDevices();
            });
        });
    }

    public configureAccessory(accessory: PlatformAccessory): void {
        //Not used for now!
    }

    private async discoverDevices(): Promise<void> {

        const videoProcessor = this.config.videoProcessor || 'ffmpeg';
        const interfaceName = this.config.interfaceName || '';

        if (this.config.videoConfig) {
            const configuredAccessories: PlatformAccessory[] = [];
            const infoLogger = Utils.createLogger(this.logger, true, false);
            const debugLogger = Utils.createLogger(this.logger, false, this.config.unifi.debug);

            const unifi = new Unifi(
                this.config.unifi,
                500,
                2,
                infoLogger
            );
            const uFlows = new UnifiFlows(
                unifi,
                this.config.unifi,
                await Unifi.determineEndpointStyle(this.config.unifi.controller, infoLogger),
                debugLogger
            );

            let cameras = [];
            try {
                cameras = await uFlows.enumerateCameras();
            } catch (error) {
                infoLogger('Cannot get cameras: ' + error);
                return;
            }

            cameras.forEach((camera) => {
                if (camera.streams.length === 0) {
                    return;
                }

                const uuid = this.api.hap.uuid.generate(camera.id);
                const cameraAccessory = new PlatformAccessory(camera.name, uuid, Categories.CAMERA);
                const cameraAccessoryInfo = cameraAccessory.getService(this.Service.AccessoryInformation);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.Manufacturer, 'Ubiquiti');
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.Model, camera.type);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.SerialNumber, camera.id);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.FirmwareRevision, camera.firmware);

                cameraAccessory.context.id = camera.id;
                cameraAccessory.context.motionEnabled = true;
                cameraAccessory.context.lastMotionId = null;
                cameraAccessory.context.lastMotionIdRepeatCount = 0;
                cameraAccessory.addService(new this.Service.MotionSensor(camera.name + ' Motion sensor'));
                cameraAccessory.addService(new this.Service.Switch(camera.name + ' Motion enabled'));
                cameraAccessory
                    .getService(this.Service.Switch)
                    .getCharacteristic(this.Characteristic.On)
                    .on(this.api.hap.CharacteristicEventTypes.GET, (callback: Function) => {
                        callback(null, cameraAccessory.context.motionEnabled);
                    })
                    .on(this.api.hap.CharacteristicEventTypes.SET, (value: boolean, callback: Function) => {
                        cameraAccessory.context.motionEnabled = value;
                        callback();
                    });

                //Make a copy of the config so we can set each one to have its own camera sources!
                const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(this.config.videoConfig));
                videoConfigCopy.stillImageSource = '-i http://' + camera.ip + '/snap.jpeg';
                //TODO: Pick the best (highest res?) stream!
                videoConfigCopy.source = '-rtsp_transport tcp -re -i ' + this.config.unifi.controller_rtsp + '/' + camera.streams[0].alias;
                videoConfigCopy.debug = this.config.unifi.debug;

                const cameraConfig = {
                    name: camera.name,
                    videoConfig: videoConfigCopy
                };

                const cameraSource = new FFMPEG(this.api.hap, cameraConfig, this.logger, videoProcessor, interfaceName);
                cameraAccessory.configureCameraSource(cameraSource);
                configuredAccessories.push(cameraAccessory);
            });
            infoLogger('Cameras: ' + configuredAccessories.length);

            try {
                const motionDetector = new MotionDetector(this.api, this.config.unifi, uFlows, cameras, debugLogger);
                await motionDetector.setupMotionChecking(configuredAccessories);
                infoLogger('Motion checking setup done!');
            } catch (error) {
                infoLogger('Error during motion checking setup: ' + error);
            }

            this.api.publishCameraAccessories(PLUGIN_NAME, configuredAccessories);
            infoLogger('Setup done');
        }
    }
}