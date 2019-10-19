const FFMPEG = require("./ffmpeg/ffmpeg").FFMPEG;

const Unifi = require("./unifi/unifi").Unifi;
const UnifiFlows = require("./unifi/unifi-flows").UnifiFlows;
const MotionDetector = require("./motion/motion").MotionDetector;

let Homebridge, Accessory, Service, Characteristic, hap, UUIDGen;

module.exports = function (homebridge) {
    Homebridge = homebridge;
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-unifi-protect-camera-motion', 'Unifi-Protect-Camera-Motion', UnifiProtectCameraMotion, true);
};

function UnifiProtectCameraMotion(log, config, api) {
    const self = this;
    self.log = log;
    self.config = config || {};

    if (api) {
        self.api = api;
        if (api.version < 2.1) {
            throw new Error('Unexpected API version.');
        }
        self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
    }
}

UnifiProtectCameraMotion.prototype.configureAccessory = function (accessory) {
    // Won't be invoked
};

UnifiProtectCameraMotion.prototype.didFinishLaunching = function () {
    const self = this;
    const videoProcessor = self.config.videoProcessor || 'ffmpeg';
    const interfaceName = self.config.interfaceName || '';

    if (self.config.videoConfig) {
        const configuredAccessories = [];

        const unifi = new Unifi(self.config.unifi, 500, 2, self.log);
        const uFlows = new UnifiFlows(unifi, self.config.unifi, self.log);

        uFlows
            .enumerateCameras()
            .then((cameras) => {
                cameras.forEach((camera) => {
                    if (camera.streams.length === 0) {
                        return;
                    }

                    const uuid = UUIDGen.generate(camera.id);
                    const cameraAccessory = new Accessory(camera.name, uuid, hap.Accessory.Categories.CAMERA);
                    const cameraAccessoryInfo = cameraAccessory.getService(Service.AccessoryInformation);
                    cameraAccessoryInfo.setCharacteristic(Characteristic.Manufacturer, 'Ubiquiti');
                    cameraAccessoryInfo.setCharacteristic(Characteristic.Model, camera.type);
                    cameraAccessoryInfo.setCharacteristic(Characteristic.SerialNumber, camera.id);
                    cameraAccessoryInfo.setCharacteristic(Characteristic.FirmwareRevision, camera.firmware);

                    cameraAccessory.context.id = camera.id;
                    cameraAccessory.context.lastMotionId = null;
                    cameraAccessory.context.lastMotionIdRepeatCount = 0;
                    cameraAccessory.addService(new Service.MotionSensor(camera.name));

                    const videoConfigCopy = JSON.parse(JSON.stringify(self.config.videoConfig));
                    videoConfigCopy.stillImageSource = '-i http://' + camera.ip + '/snap.jpeg';
                    //TODO: Pick the correct stream!
                    videoConfigCopy.source = '-rtsp_transport http -re -i ' + self.config.unifi.controller_rtsp + '/' + camera.streams[0].alias;

                    const cameraConfig = {
                        name: camera.name,
                        videoConfig: videoConfigCopy
                    };

                    const cameraSource = new FFMPEG(hap, cameraConfig, self.log, videoProcessor, interfaceName);
                    cameraAccessory.configureCameraSource(cameraSource);
                    configuredAccessories.push(cameraAccessory);
                });
                self.log('Cameras: ' + configuredAccessories.length);

                const motionDetector = new MotionDetector(Homebridge, self.config.unifi, uFlows, cameras, self.log);
                motionDetector.setupMotionChecking(configuredAccessories)
                    .then(() => {
                        self.log('Motion checking setup done!');
                    })
                    .catch((error) => {
                        self.log('Error during motion checking setup: ' + error);
                    });

                self.api.publishCameraAccessories('Unifi-Protect-Camera-Motion', configuredAccessories);
                self.log('Setup done');
            })
            .catch((error) => {
                self.log('Cannot get cameras: ' + error);
            });
    }
};
