import {UnifiCamera, UnifiConfig, UnifiMotionEvent} from "../unifi/unifi";
import {Detection, Detector, Loader} from "./coco/loader";
import {UnifiFlows} from "../unifi/unifi-flows";
import {Canvas, Image} from "canvas";
import {ImageUtils} from "../utils/image-utils";
import {GooglePhotos, GooglePhotosConfig} from "../utils/google-photos";
import type {API, Logging, PlatformAccessory, PlatformConfig} from 'homebridge';
import {UnifiStreamingDelegate} from "../streaming/unifi-streaming-delegate";

export class MotionDetector {

    private readonly api: API;

    private readonly unifiConfig: UnifiConfig;
    private readonly googlePhotosConfig: GooglePhotosConfig;
    private readonly flows: UnifiFlows;
    private readonly cameras: UnifiCamera[];
    private readonly log: Logging;

    private modelLoader: Loader;
    private detector: Detector;
    private gPhotos: GooglePhotos;
    private configuredAccessories: any[];

    constructor(api: API, config: PlatformConfig, unifiFlows: UnifiFlows, cameras: UnifiCamera[], log: Logging) {
        this.api = api;

        this.unifiConfig = config.unifi;
        this.googlePhotosConfig = config.googlePhotos;
        this.flows = unifiFlows;
        this.cameras = cameras;

        this.log = log;

        this.modelLoader = new Loader(log);
        this.detector = null;

        const userStoragePath: string = this.api.user.storagePath();
        ImageUtils.userStoragePath = userStoragePath;
        this.gPhotos = this.googlePhotosConfig && this.googlePhotosConfig.upload_gphotos ? new GooglePhotos(config.googlePhotos, userStoragePath, log) : null;
    }

    public async setupMotionChecking(configuredAccessories: PlatformAccessory[]): Promise<any> {
        this.configuredAccessories = configuredAccessories;

        this.cameras.forEach((camera: UnifiCamera) => {
            const matchingStreamingDelegate: UnifiStreamingDelegate = UnifiStreamingDelegate.instances.find((streamingDelegate: UnifiStreamingDelegate) => {
                return camera.id === streamingDelegate.cameraId;
            });
            if (matchingStreamingDelegate) {
                matchingStreamingDelegate.setCamera(camera);
            } else {
                this.log.debug('Cannot update camera for snapshot handling: ' + camera.name);
            }
        });

        let intervalFunction: Function;
        if (this.unifiConfig.enhanced_motion) {
            this.detector = await this.modelLoader.loadCoco();
            intervalFunction = this.checkMotionEnhanced.bind(this);
        } else {
            intervalFunction = this.checkMotion.bind(this);
        }

        outer: for (const camera of this.cameras) {
            for (const configuredAccessory of this.configuredAccessories) {
                if (configuredAccessory.context.id === camera.id) {
                    //configuredAccessory.context.streamingDelegate.setCamera(camera);
                    continue outer;
                }
            }
        }

        setInterval(() => {
            try {
                intervalFunction();
            } catch (error) {
                this.log.debug('Error during motion interval loop: ' + error);
            }
        }, this.unifiConfig.motion_interval);
        return;
    }

    private async checkMotion(): Promise<any> {
        try {
            await this.flows.assignMotionEventsToCameras(this.cameras);
        } catch (error) {
            this.log.debug('Cannot get latest motion info: ' + error);
        }

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
            if (!configuredAccessory.context.motionEnabled) {
                continue;
            }

            for (const camera of this.cameras) {
                if (configuredAccessory.context.id === camera.id) {
                    camera.lastDetectionSnapshot = null;
                    if (!camera.lastMotionEvent || this.isSkippableLongRunningMotion(configuredAccessory, camera.lastMotionEvent)) {
                        continue outer;
                    }

                    this.log.info('Motion detected (' + camera.lastMotionEvent.score + '%) by camera ' + camera.name + ' !!!!');
                    configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);

                    let snapshot: Image;
                    try {
                        snapshot = await ImageUtils.createImage('http://' + camera.ip + '/snap.jpeg');
                        camera.lastDetectionSnapshot = await this.persistSnapshot(snapshot, 'Motion detected (' + camera.lastMotionEvent.score + '%) by camera ' + camera.name, []);
                    } catch (error) {
                        this.log.debug('Cannot save snapshot: ' + error);
                    }

                    continue outer;
                }
            }
        }
    }

    private async checkMotionEnhanced(): Promise<any> {
        try {
            await this.flows.assignMotionEventsToCameras(this.cameras);
        } catch (error) {
            this.log.debug('Cannot get latest motion info: ' + error);
        }

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
            if (!configuredAccessory.context.motionEnabled) {
                continue;
            }

            for (const camera of this.cameras) {
                if (configuredAccessory.context.id === camera.id) {
                    camera.lastDetectionSnapshot = null;
                    if (!camera.lastMotionEvent) {
                        continue outer;
                    }

                    let snapshot: Image;
                    try {
                        snapshot = await ImageUtils.createImage('http://' + camera.ip + '/snap.jpeg');
                    } catch (error) {
                        continue outer;
                    }
                    const detections: Detection[] = await this.detector.detect(snapshot, this.unifiConfig.debug);

                    for (const classToDetect of this.unifiConfig.enhanced_classes) {
                        const detection: Detection = this.getDetectionForClassName(classToDetect, detections);

                        if (detection) {
                            if (this.isSkippableLongRunningMotion(configuredAccessory, camera.lastMotionEvent)) {
                                continue outer;
                            }

                            const score: number = Math.round(detection.score * 100);
                            if (score >= this.unifiConfig.enhanced_motion_score) {
                                this.log.info('Detected: ' + classToDetect + ' (' + score + '%) by camera ' + camera.name);
                                camera.lastDetectionSnapshot = await this.persistSnapshot(snapshot, classToDetect + ' detected (' + score + '%) by camera ' + camera.name, [detection]);
                                configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);
                                continue outer;
                            } else {
                                this.log.debug('Detected class: ' + detection.class + ' rejected due to score: ' + score + '% (must be ' + this.unifiConfig.enhanced_motion_score + '% or higher)');
                            }
                        } else {
                            this.log.debug('None of the required classes found by enhanced motion detection, discarding!');
                        }
                    }
                }
            }
        }
    }

    private async persistSnapshot(snapshot: Image, description: string, detections: Detection[]): Promise<Canvas> {
        try {
            let annotatedImage: Canvas = await ImageUtils.generateAnnotatedImage(snapshot, detections);

            //Save image locally
            if ((this.unifiConfig.save_snapshot || this.googlePhotosConfig.upload_gphotos) && annotatedImage) {
                const fileLocation: string = await ImageUtils.saveCanvasToFile(annotatedImage);
                this.log.debug('The snapshot has been saved to: ' + fileLocation);

                if (this.googlePhotosConfig.upload_gphotos) {
                    const fileName: string = fileLocation.split('/').pop();

                    this.gPhotos
                        .uploadImage(fileLocation, fileName, description)
                        .then((url: string) => {
                            if (url) {
                                this.log.debug('Photo uploaded: ' + url);
                            } else {
                                this.log.debug('Photo not uploaded!');
                            }

                            if (!this.unifiConfig.save_snapshot) {
                                ImageUtils.remove(fileLocation);
                                this.log.debug('The snapshot has been removed from: ' + fileLocation);
                            }
                        });
                }
            }

            return annotatedImage;
        } catch (error) {
            this.log.debug('Error persisting snapshot image: ' + error);
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
                    this.log.debug('Motion detected inside of skippable timeframe, ignoring!');
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
