const path = require("path");

const FFMPEG = require('./ffmpeg/ffmpeg').FFMPEG;

const Unifi = require("./unifi/unifi").Unifi;
const UnifiFlows = require("./unifi/unifi-flows").UnifiFlows;
const Loader = require("./coco/loader").Loader;

let Accessory, Service, Characteristic, hap, UUIDGen;

module.exports = function (homebridge) {
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

        const unifi = new Unifi(self.config.unifi.controller, self.config.unifi.motion_score, self.config.unifi.motion_interval, 500, 2, self.log);
        const uFlows = new UnifiFlows(unifi, self.config.unifi.username, self.config.unifi.password, self.log);

        uFlows
            .enumerateCameras()
            .then((cameras) => {
                cameras.forEach((camera) => {
                    if(camera.streams.length === 0) {
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
                    cameraAccessory.context.log = self.log;
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

                setMotionCheckInterval(self.config.unifi ,uFlows, cameras, configuredAccessories);

                console.log('Cams: ' + configuredAccessories.length);
                self.api.publishCameraAccessories('Unifi-Protect-Camera-Motion', configuredAccessories);
                self.log('Setup done');
            })
            .catch((error) => {
                self.log('Cannot get cameras: ' + error);
            });
    }
};

function setMotionCheckInterval(unifiConfig, unifiFlows, cameras, configuredAccessories) {
    if (unifiConfig.enhanced_motion) {
        Loader
            .loadCoco(false, path.dirname(require.resolve('homebridge-unifi-protect-camera-motion/package.json')))
            .then((detector) => {
                setInterval(checkMotionEnhanced.bind(this,unifiConfig.enhanced_classes, unifiFlows, cameras, configuredAccessories, detector), unifiConfig.motion_interval);
            });
    } else {
        setInterval(checkMotion.bind(this, unifiFlows, cameras, configuredAccessories), unifiConfig.motion_interval);
    }
}

function checkMotion(unifiFlows, cameras, configuredAccessories) {
    unifiFlows
        .detectMotion(cameras)
        .then((motionEvents) => {
            outer: for (const configuredAccessory of configuredAccessories) {
                configuredAccessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, 0);

                for (const motionEvent of motionEvents) {
                    if (motionEvent.camera.id === configuredAccessory.context.id) {
                        console.log('!!!! Motion detected (' + motionEvent.score + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                        configuredAccessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, 1);

                        continue outer;
                    }
                }
            }
        });
}

function checkMotionEnhanced(classesToDetect, unifiFlows, cameras, configuredAccessories, detector) {
    unifiFlows
        .detectMotion(cameras)
        .then((motionEvents) => {

            outer: for (const configuredAccessory of configuredAccessories) {
                configuredAccessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, 0);

                for (const motionEvent of motionEvents) {
                    if (motionEvent.camera.id === configuredAccessory.context.id) {
                        Loader
                            .createImage('http://' + motionEvent.camera.ip + '/snap.jpeg')
                            .then((snapshot) => {
                                return detector.detect(snapshot);
                            })
                            .then((detectedClasses) => {
                                for (const classToDetect of classesToDetect) {
                                    const cls = getClass(classToDetect.toLowerCase(), detectedClasses);
                                    if (cls) {
                                        console.log('!!!! ' + classToDetect +' detected (' + Math.round(cls.score * 100) + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                                        configuredAccessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, 1);
                                    }
                                }
                            })
                            .catch((error) => {
                               console.log('Error with enhanced detection: ' + error);
                            });

                        continue outer;
                    }
                }
            }
        });
}

function getClass(className, classes) {
    for (const cls of classes) {
        if(cls.class.toLowerCase() === className.toLowerCase()) {
            return cls;
        }
    }
    return null;
}
