import { UnifiCamera, UnifiConfig, UnifiMotionEvent } from "../unifi/unifi.js";
import { UnifiFlows } from "../unifi/unifi-flows.js";
import { Canvas, Image } from "canvas";
import { ImageUtils } from "../utils/image-utils.js";
import { GooglePhotos, GooglePhotosConfig } from "../utils/google-photos.js";
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { Mqtt } from "../utils/mqtt.js";
import FormData from "form-data";
import { fileURLToPath } from "url";

export class MotionDetector {

    private readonly api: API;

    private readonly config: PlatformConfig;
    private readonly unifiConfig: UnifiConfig;
    private readonly googlePhotosConfig: GooglePhotosConfig;
    private readonly flows: UnifiFlows;
    private readonly cameras: UnifiCamera[];
    private readonly log: Logging;

    private gPhotos: GooglePhotos;
    private mqtt: Mqtt;
    private configuredAccessories: PlatformAccessory[];

    private intervalFunction: Function | undefined;

    constructor(api: API, config: PlatformConfig, mqtt: Mqtt, unifiFlows: UnifiFlows, cameras: UnifiCamera[], log: Logging) {
        this.api = api;

        this.config = config;
        this.unifiConfig = config.unifi as UnifiConfig;
        this.googlePhotosConfig = config.googlePhotos as GooglePhotosConfig;
        this.flows = unifiFlows;
        this.cameras = cameras;

        this.log = log;

        const userStoragePath: string = this.api.user.storagePath();
        ImageUtils.userStoragePath = userStoragePath;
        this.gPhotos = config.upload_gphotos && this.googlePhotosConfig ? new GooglePhotos(config.googlePhotos as GooglePhotosConfig, userStoragePath, log) : null;
        this.mqtt = mqtt;

        this.intervalFunction = this.checkMotion;
    }

    public setupMotionChecking = async (configuredAccessories: PlatformAccessory[]): Promise<void> => {
        await this.flows.startMotionEventTracking(this.onMotionEvent);
        
        this.configuredAccessories = configuredAccessories;

        if (this.unifiConfig.enhanced_motion) {
            this.log.info("Starting enhanced python detector...");
            try {
                await this.startDetector();
                this.intervalFunction = this.checkMotionEnhanced;
                this.log.info("Python detector started");
            } catch (error) {
                this.log.warn(JSON.stringify(error, null, 4));
                this.log.info("Python detector could not be started, falling back to regular checking!");
            }
        }
    }

    private onMotionEvent = async (motionEvent: UnifiMotionEvent): Promise<void> => {
        if (this.intervalFunction) {
            await this.intervalFunction(motionEvent);
        } else {
            this.log.warn('No motion handler function set!');
        }
    }

    private checkMotion = async (motionEvent: UnifiMotionEvent): Promise<any> => {
        const camera = this.cameras.find((camera) => camera.id === motionEvent.cameraId);
        if (!camera) {
            this.log.warn('WARNING: No matching camera found for motion event!');
            return;
        }
        // TODO: Check is the motion event is already known!
        camera.lastMotionEvent = motionEvent;

        const enabledMotionAccessories = this.configuredAccessories.filter((accessory) => accessory.context.motionEnabled);

        const matchingAccessory = enabledMotionAccessories.find((accessory) => accessory.context.id === camera.id);
        if (!matchingAccessory) {
            this.log.warn('WARNING: No accessory found that belongs to the camera that generated the motion event!');
            return;
        }
       
        if (this.isSkippableLongRunningMotion(matchingAccessory, motionEvent)) {
            return
        }

        camera.lastDetectionSnapshot = null;

        this.log.info('Motion detected (' + motionEvent.score + '%) by camera ' + camera.name + ' !!!!');
        
        // TODO: Set the motion back to 0 after the event is done or x amount of time!
        matchingAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);
        
        try {
            const snapshot = await ImageUtils.createImage('http://' + camera.ip + '/snap.jpeg');
            const snapshotCanvas = await this.persistSnapshot(snapshot, 'Motion detected (' + motionEvent.score + '%) by camera ' + camera.name, []);
            camera.lastDetectionSnapshot = snapshotCanvas.toBuffer('image/jpeg');

            this.mqtt.sendMessageOnTopic(JSON.stringify({ score: motionEvent.score, timestamp: new Date().toISOString(), snapshot: ImageUtils.resizeCanvas(snapshotCanvas, 480, 270).toBuffer('image/jpeg', { quality: 0.5 }).toString('base64') }), camera.name);

        } catch (error) {
            this.log.debug('Cannot save snapshot: ' + error);
        }
    }

    private checkMotionEnhanced = async (motionEvent: UnifiMotionEvent): Promise<any> => {
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
                    const form = new FormData();
                    try {
                        snapshot = await ImageUtils.createImage('http://' + camera.ip + '/snap.jpeg');
                        let fimg = await fetch('http://' + camera.ip + '/snap.jpeg');
                        const buffer = Buffer.from(await fimg.arrayBuffer());
                        const fileName = 'detection-' + camera.name + 'jpg';

                        form.append('imageFile', buffer, {
                            contentType: 'text/plain',
                            filename: fileName,
                        });
                    } catch (error) {
                        continue outer;
                    }

                    const nFetch = (await import('node-fetch')).default;

                    const start = Date.now();
                    const data = await nFetch('http://127.0.0.1:5050', { method: 'POST', body: form });
                    this.log.debug(camera.name + ' upload + yolo processing took: ' + (Date.now() - start) + 'ms');
                    const detections: Detection[] = this.mapDetectorJsonToDetections(await data.json() as RawDetection);

                    for (const classToDetect of this.unifiConfig.enhanced_classes) {
                        const detection: Detection = this.getDetectionForClassName(classToDetect, detections);

                        if (detection) {
                            if (this.isSkippableLongRunningMotion(configuredAccessory, camera.lastMotionEvent)) {
                                continue outer;
                            }

                            const score: number = Math.round(detection.score * 100);
                            if (score >= this.unifiConfig.enhanced_motion_score) {
                                this.log.info('Detected: ' + detection.class + ' (' + score + '%) by camera ' + camera.name);

                                const snapshotCanvas = await this.persistSnapshot(snapshot, detection.class + ' detected (' + score + '%) by camera ' + camera.name, [detection]);

                                camera.lastDetectionSnapshot = snapshotCanvas.toBuffer('image/jpeg');
                                configuredAccessory.getService(this.api.hap.Service.MotionSensor).setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);
                                this.mqtt.sendMessageOnTopic(JSON.stringify({ class: detection.class, score, timestamp: new Date().toISOString(), snapshot: ImageUtils.resizeCanvas(snapshotCanvas, 480, 270).toBuffer('image/jpeg', { quality: 0.5 }).toString('base64') }), camera.name);
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

    private persistSnapshot = async (snapshot: Image, description: string, detections: Detection[]): Promise<Canvas> => {
        try {
            let annotatedImage: Canvas = await ImageUtils.generateAnnotatedImage(snapshot, detections);

            //Save image locally
            if ((this.unifiConfig.save_snapshot || this.config.upload_gphotos) && annotatedImage) {
                const fileLocation: string = await ImageUtils.saveCanvasToFile(annotatedImage);
                this.log.debug('The snapshot has been saved to: ' + fileLocation);

                if (this.config.upload_gphotos) {
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

    private isSkippableLongRunningMotion = (accessory: any, motionEvent: UnifiMotionEvent): boolean => {
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

    private getDetectionForClassName(className: string, detections: Detection[]): Detection | null {
        for (const detection of detections) {
            if (detection.class.toLowerCase() === className.toLowerCase()) {
                return detection;
            }
        }
        return null;
    }

    private startDetector = async(): Promise<void> => {

        const execa = (await import('execa')).execa;

        const temp: string = fileURLToPath(import.meta.url).replace('motion.js', '');
        await execa('python3', ['detector.py'], { cwd: temp + 'detector/' });
    }

    private mapDetectorJsonToDetections(input: RawDetection): Detection[] {
        const detectionKeys: string[] = Object.keys(input.xmin) || [];

        const detections: Detection[] = [];
        for (let i = 0; i < detectionKeys.length - 1; i++) {
            detections.push({
                class: input.name[detectionKeys[i]],
                score: input.confidence[detectionKeys[i]],
                bbox: [
                    input.xmin[detectionKeys[i]],
                    input.ymin[detectionKeys[i]],
                    (input.xmax[detectionKeys[i]] - input.xmin[detectionKeys[i]]),
                    (input.ymax[detectionKeys[i]] - input.ymin[detectionKeys[i]])
                ]
            });
        }

        return detections;
    }
}

export type Detection = {
    class: string;
    score: number;
    bbox: number[];
    /*
        bbox[0] = minX;
        bbox[1] = minY;
        bbox[2] = maxX - minX;
        bbox[3] = maxY - minY;
    */
}

export type RawDetection = {
    xmin: any, ymin: any, xmax: any, ymax: any, class: any, name: any, confidence: any
}
