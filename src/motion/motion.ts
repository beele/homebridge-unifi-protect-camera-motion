import {UnifiCamera, UnifiConfig, UnifiMotionEvent} from "../unifi/unifi";
import {Detection, Detector, Loader} from "../coco/loader";
import {UnifiFlows} from "../unifi/unifi-flows";
import {Image} from "canvas";
import {ImageUtils} from "../utils/image-utils";
import {GooglePhotos, GooglePhotosConfig} from "../utils/google-photos";
import type { API, PlatformConfig} from 'homebridge';

const path = require('path');

export class MotionDetector {

    private readonly api: API;

    private readonly unifiConfig: UnifiConfig;
    private readonly googlePhotosConfig: GooglePhotosConfig;
    private readonly flows: UnifiFlows;
    private readonly cameras: UnifiCamera[];
    private readonly logInfo: Function;
    private readonly logDebug: Function;

    private modelLoader: Loader;
    private detector: Detector;
    private gPhotos: GooglePhotos;
    private configuredAccessories: any[];

    constructor(api: API, config: PlatformConfig, unifiFlows: UnifiFlows, cameras: UnifiCamera[], infoLogger: Function, debugLogger: Function) {
        this.api = api;

        this.unifiConfig = config.unifi;
        this.googlePhotosConfig = config.googlePhotos;
        this.flows = unifiFlows;
        this.cameras = cameras;

        this.logInfo = infoLogger;
        this.logDebug = debugLogger;

        this.modelLoader = new Loader(infoLogger);
        this.detector = null;

        const userStoragePath: string = this.api.user.storagePath();
        ImageUtils.userStoragePath = userStoragePath;
        this.gPhotos = this.googlePhotosConfig && this.googlePhotosConfig.upload_gphotos ? new GooglePhotos(config.googlePhotos, userStoragePath, infoLogger, debugLogger) : null;
    }

    public async setupMotionChecking(configuredAccessories: any[]): Promise<any> {
        this.configuredAccessories = configuredAccessories;

        let intervalFunction: Function;
        if (this.unifiConfig.enhanced_motion) {
            try {
                this.detector = await this.modelLoader.loadCoco(false, path.dirname(require.resolve('homebridge-unifi-protect-camera-motion/package.json')));
            } catch (error) {
                this.detector = await this.modelLoader.loadCoco(false, './');
            }
            intervalFunction = this.checkMotionEnhanced.bind(this);
        } else {
            intervalFunction = this.checkMotion.bind(this);
        }

        setInterval(() => {
            try {
                intervalFunction();
            } catch (error) {
                this.logDebug('Error during motion interval loop: ' + error);
            }
        }, this.unifiConfig.motion_interval);
        return;
    }

    private async checkMotion(): Promise<any> {
        let motionEvents: UnifiMotionEvent[];
        try {
            motionEvents = await this.flows.getLatestMotionEventPerCamera(this.cameras);
        } catch (error) {
            this.logDebug('Cannot get latest motion info: ' + error);
            motionEvents = [];
        }

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
            if (!configuredAccessory.context.motionEnabled) {
                continue;
            }

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    if (this.isSkippableLongRunningMotion(configuredAccessory, motionEvent)) {
                        return;
                    }

                    this.logInfo('Motion detected (' + motionEvent.score + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                    configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);

                    let snapshot: Image;
                    try {
                        snapshot = await ImageUtils.createImage('http://' + motionEvent.camera.ip + '/snap.jpeg');
                        this.persistSnapshot(snapshot, 'Motion detected (' + motionEvent.score + '%) by camera ' + motionEvent.camera.name, []);
                    } catch (error) {
                        this.logDebug('Cannot save snapshot: ' + error);
                    }

                    continue outer;
                }
            }
        }
    }

    private async checkMotionEnhanced(): Promise<any> {
        let motionEvents: UnifiMotionEvent[];
        try {
            motionEvents = await this.flows.getLatestMotionEventPerCamera(this.cameras);
        } catch (error) {
            this.logDebug('Cannot get latest motion info: ' + error);
            motionEvents = [];
        }

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
            if (!configuredAccessory.context.motionEnabled) {
                continue;
            }

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    let snapshot: Image;
                    try {
                        snapshot = await ImageUtils.createImage('http://' + motionEvent.camera.ip + '/snap.jpeg');
                    } catch (error) {
                        continue;
                    }
                    const detections: Detection[] = await this.detector.detect(snapshot, this.unifiConfig.debug);

                    for (const classToDetect of this.unifiConfig.enhanced_classes) {
                        const detection: Detection = this.getDetectionForClassName(classToDetect, detections);

                        if (detection) {
                            if (this.isSkippableLongRunningMotion(configuredAccessory, motionEvent)) {
                                return;
                            }

                            const score: number = Math.round(detection.score * 100);
                            if (score >= this.unifiConfig.enhanced_motion_score) {
                                this.logInfo('Detected: ' + classToDetect + ' (' + score + '%) by camera ' + motionEvent.camera.name);
                                configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);
                                await this.persistSnapshot(snapshot, classToDetect + ' detected (' + score + '%) by camera ' + motionEvent.camera.name, [detection]);
                                continue outer;
                            } else {
                                this.logDebug('Detected class: ' + detection.class + ' rejected due to score: ' + score + '% (must be ' + this.unifiConfig.enhanced_motion_score + '% or higher)');
                            }
                        } else {
                            this.logDebug('None of the required classes found by enhanced motion detection, discarding!');
                        }
                    }
                }
            }
        }
    }

    private async persistSnapshot(snapshot: Image, description: string, detections: Detection[]): Promise<void> {
        let localImagePath: string = null;
        try {
            if (this.unifiConfig.save_snapshot) {
                localImagePath = await ImageUtils.saveAnnotatedImage(snapshot, detections);
                this.logDebug('The snapshot has been saved to: ' + localImagePath);
            }
        } catch (error) {
            this.logDebug('Snapshot cannot be saved locally: ' + error);
        }

        try {
            if (this.googlePhotosConfig.upload_gphotos) {
                let imagePath: string = localImagePath ? localImagePath : await ImageUtils.saveAnnotatedImage(snapshot, detections);
                const fileName: string = imagePath.split('/').pop();
                //No await because the upload should not block!
                this.gPhotos
                    .uploadImage(imagePath, fileName, description)
                    .then((url: string) => {
                        if (url) {
                            this.logDebug('Photo uploaded: ' + url);
                        } else {
                           this.logDebug('Photo not uploaded!');
                        }

                        if (!localImagePath) {
                            ImageUtils.remove(imagePath);
                        }
                    });
            }
        } catch (error) {
            this.logDebug('Snapshot cannot be uploaded to Google Photos: ' + error);
        }
    }

    private isSkippableLongRunningMotion(accessory: any, motionEvent: UnifiMotionEvent): boolean {
        //Prevent repeat motion notifications for motion events that are longer then the motion_interval unifiConfig setting!
        if (this.unifiConfig.motion_repeat_interval) {
            if (accessory.context.lastMotionId === motionEvent.id) {
                accessory.context.lastMotionIdRepeatCount++;

                if (accessory.context.lastMotionIdRepeatCount === (this.unifiConfig.motion_repeat_interval / this.unifiConfig.motion_interval)) {
                    accessory.context.lastMotionIdRepeatCount = 0;
                } else {
                    this.logDebug('Motion detected inside of skippable timeframe, ignoring!');
                    return true;
                }
            } else {
                accessory.context.lastMotionId = motionEvent.id;
                accessory.context.lastMotionIdRepeatCount = 0;
            }
        }
        return false;
    }

    private getDetectionForClassName(className: string, detections: Detection[]) {
        for (const detection of detections) {
            if (detection.class.toLowerCase() === className.toLowerCase()) {
                return detection;
            }
        }
        return null;
    }
}
