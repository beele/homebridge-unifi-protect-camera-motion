import { Canvas, Image } from "canvas";
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { fileURLToPath } from "url";
import { Unifi, UnifiCamera, UnifiConfig, UnifiMotionEvent } from "../unifi/unifi.js";
import { GooglePhotos, GooglePhotosConfig } from "../utils/google-photos.js";
import { ImageUtils } from "../utils/image-utils.js";
import { Mqtt } from "../utils/mqtt.js";

export class MotionDetector {

    private readonly api: API;
    private readonly log: Logging;
    private readonly config: PlatformConfig;

    private readonly unifiConfig: UnifiConfig;
    private readonly unifi: Unifi;
    private readonly cameras: UnifiCamera[];

    private readonly googlePhotosConfig: GooglePhotosConfig;
    private readonly gPhotos: GooglePhotos | undefined;

    private mqtt: Mqtt;
    private configuredAccessories: PlatformAccessory[] = [];

    private eventCallback: Function | undefined;

    constructor(api: API, config: PlatformConfig, mqtt: Mqtt, unifi: Unifi, cameras: UnifiCamera[], log: Logging) {
        this.api = api;
        this.log = log;
        this.config = config;

        this.unifiConfig = config.unifi as UnifiConfig;
        this.unifi = unifi;
        this.cameras = cameras;

        this.googlePhotosConfig = config.googlePhotos as GooglePhotosConfig;

        const userStoragePath: string = this.api.user.storagePath();
        ImageUtils.userStoragePath = userStoragePath;
        this.gPhotos = config.upload_gphotos && this.googlePhotosConfig ? new GooglePhotos(config.googlePhotos as GooglePhotosConfig, userStoragePath, log) : undefined;

        this.mqtt = mqtt;

        this.eventCallback = this.checkMotion;
    }

    public setupMotionChecking = async (configuredAccessories: PlatformAccessory[]): Promise<void> => {
        await this.unifi.startMotionEventTracking(this.onMotionEvent);

        this.configuredAccessories = configuredAccessories;

        if (this.unifiConfig.enhanced_motion) {
            this.log.info("Starting enhanced python detector...");
            try {
                await this.startDetector();
                this.eventCallback = this.checkMotionEnhanced;
                this.log.info("Python detector started");
            } catch (error) {
                this.log.warn(JSON.stringify(error, null, 4));
                this.log.info("Python detector could not be started, falling back to regular checking!");
            }
        }
    }

    private onMotionEvent = async (motionEvent: UnifiMotionEvent): Promise<void> => {
        if (this.eventCallback) {
            await this.eventCallback(motionEvent);
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

        const matchingAccessory = this.configuredAccessories.find((accessory) => accessory.context.motionEnabled && accessory.context.id === camera.id);
        if (!matchingAccessory) {
            this.log.warn('WARNING: No accessory found that belongs to the camera that generated the motion event!');
            return;
        }

        if (this.isSkippableLongRunningMotion(matchingAccessory, motionEvent)) {
            return;
        }

        // TODO: Check is the motion event is already known!
        camera.lastMotionEvent = motionEvent;
        camera.lastDetectionSnapshot = undefined;

        this.log.info('Motion detected (' + motionEvent.score + '%) by camera ' + camera.name + ' !!!!');

        matchingAccessory.getService(this.api.hap.Service.MotionSensor)?.setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);
        // Reset the motion sensor after the interval has passed.
        // Only reset it if no new motion event has occurred (and has it's interval still pending).
        setTimeout(() => {
            if (motionEvent.id !== camera.lastMotionEvent?.id) {
                return;
            }
            matchingAccessory.getService(this.api.hap.Service.MotionSensor)?.setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
        }, this.unifiConfig.motion_interval);

        try {
            const snapshot = await ImageUtils.createImage('http://' + camera.ip + '/snap.jpeg');
            const snapshotCanvas = await this.persistSnapshot(snapshot, 'Motion detected (' + motionEvent.score + '%) by camera ' + camera.name, []);

            if (!snapshotCanvas) {
                this.mqtt.sendMessageOnTopic(JSON.stringify({ score: motionEvent.score, timestamp: new Date().toISOString(), snapshot: undefined }), camera.name);
                return;
            }

            camera.lastDetectionSnapshot = snapshotCanvas.toBuffer('image/jpeg');
            this.mqtt.sendMessageOnTopic(JSON.stringify({ score: motionEvent.score, timestamp: new Date().toISOString(), snapshot: ImageUtils.resizeCanvas(snapshotCanvas, 480, 270).toBuffer('image/jpeg', { quality: 0.5 }).toString('base64') }), camera.name);

        } catch (error) {
            this.log.debug('Cannot save snapshot: ' + error);
        }
    }

    private checkMotionEnhanced = async (motionEvent: UnifiMotionEvent): Promise<any> => {
        const camera = this.cameras.find((camera) => camera.id === motionEvent.cameraId);
        if (!camera) {
            this.log.warn('WARNING: No matching camera found for motion event!');
            return;
        }

        const matchingAccessory = this.configuredAccessories.find((accessory) => accessory.context.motionEnabled && accessory.context.id === camera.id);
        if (!matchingAccessory) {
            this.log.warn('WARNING: No accessory found that belongs to the camera that generated the motion event!');
            return;
        }

        if (this.isSkippableLongRunningMotion(matchingAccessory, motionEvent)) {
            return;
        }

        // TODO: Check is the motion event is already known!
        camera.lastMotionEvent = motionEvent;
        camera.lastDetectionSnapshot = undefined;

        let snapshot: Image | undefined;
        const form = new FormData();
        try {
            let fimg = await fetch('http://' + camera.ip + '/snap.jpeg');
            const imgRaw = await fimg.arrayBuffer();
            snapshot = new Image();
            snapshot.src = Buffer.from(imgRaw);

            const fileName = 'detection-' + camera.name + '.jpg';

            form.append('imageFile', new Blob([imgRaw]), fileName);
        } catch (error) {
            this.log.warn('Could not fetch snapshot for camera: ' + camera.name);
        }

        let detections: Detection[] = [];

        try {
            const start = Date.now();
            const data = await fetch('http://127.0.0.1:5050', { method: 'POST', body: form });
            this.log.debug(camera.name + ' upload + yolo processing took: ' + (Date.now() - start) + 'ms');

            if (data.status !== 200) {
                //this.log.debug(JSON.stringify(data, null, 4));
                throw new Error('YoLo request failed: ' + data.statusText);
            }

            console.log('TEST');
            detections = this.mapDetectorJsonToDetections(await data.json() as RawDetection);

        } catch (error) {
            this.log.warn('YoLo failure');
            console.log(error);
            this.log.warn(JSON.stringify(error, null, 4));
            // TODO: Fall back to regular checking?
            return;
        }

        this.unifiConfig.enhanced_classes
            .forEach(async (classToDetect) => {
                const detection = this.getDetectionForClassName(classToDetect, detections);
                if (!detection) {
                    this.log.debug('None of the required classes found by enhanced motion detection, discarding!');
                    return;
                }

                const score: number = Math.round(detection.score * 100);
                if (score < this.unifiConfig.enhanced_motion_score) {
                    this.log.debug('Detected class: ' + detection.class + ' rejected due to score: ' + score + '% (must be ' + this.unifiConfig.enhanced_motion_score + '% or higher)');
                    return;
                }

                this.log.info('Detected: ' + detection.class + ' (' + score + '%) by camera ' + camera.name);
                matchingAccessory.getService(this.api.hap.Service.MotionSensor)?.setCharacteristic(this.api.hap.Characteristic.MotionDetected, 1);

                // Reset the motion sensor after the interval has passed.
                // Only reset it if no new motion event has occurred (and has it's interval still pending).
                setTimeout(() => {
                    if (motionEvent.id !== camera.lastMotionEvent?.id) {
                        return;
                    }
                    matchingAccessory.getService(this.api.hap.Service.MotionSensor)?.setCharacteristic(this.api.hap.Characteristic.MotionDetected, 0);
                }, this.unifiConfig.motion_interval);

                if (!snapshot) {
                    this.mqtt.sendMessageOnTopic(JSON.stringify({ class: detection.class, score, timestamp: new Date().toISOString(), snapshot: undefined }), camera.name);
                    return;
                }

                const snapshotCanvas = await this.persistSnapshot(snapshot, detection.class + ' detected (' + score + '%) by camera ' + camera.name, [detection]);
                if (!snapshotCanvas) {
                    this.mqtt.sendMessageOnTopic(JSON.stringify({ class: detection.class, score, timestamp: new Date().toISOString(), snapshot: undefined }), camera.name);
                    return;
                }

                camera.lastDetectionSnapshot = snapshotCanvas.toBuffer('image/jpeg');
                this.mqtt.sendMessageOnTopic(JSON.stringify({ class: detection.class, score, timestamp: new Date().toISOString(), snapshot: ImageUtils.resizeCanvas(snapshotCanvas, 480, 270).toBuffer('image/jpeg', { quality: 0.5 }).toString('base64') }), camera.name);
            }
            );
    }

    private persistSnapshot = async (snapshot: Image, description: string, detections: Detection[]): Promise<Canvas | undefined> => {
        try {
            const annotatedImage: Canvas = await ImageUtils.generateAnnotatedImage(snapshot, detections);

            if ((!this.unifiConfig.save_snapshot && !this.config.upload_gphotos) || !annotatedImage) {
                return;
            }

            const fileLocation: string = await ImageUtils.saveCanvasToFile(annotatedImage);
            this.log.debug('The snapshot has been saved to: ' + fileLocation);

            const fileName = fileLocation.split('/').pop();
            if (!this.config.upload_gphotos || !this.gPhotos || !fileName) {
                return;
            }

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

    private getDetectionForClassName = (className: string, detections: Detection[]): Detection | undefined => {
        for (const detection of detections) {
            if (detection.class.toLowerCase() === className.toLowerCase()) {
                return detection;
            }
        }
        return undefined;
    }

    private startDetector = async (): Promise<void> => {
        const execa = (await import('execa')).execa;

        const temp: string = fileURLToPath(import.meta.url).replace('motion.js', '');
        try {
            execa('python3.11', ['detector.py'], { cwd: temp + 'detector/' })
            .then((result) => {
                this.log.debug(result.stdout);
                this.log.warn(result.stderr);
            })
            .catch((error) => {
                this.log.warn(JSON.stringify(error, null, 4));
            });
        } catch (error) {
            this.log.warn(JSON.stringify(error, null, 4));
        }
    }

    private mapDetectorJsonToDetections = (input: RawDetection): Detection[] => {
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
    xmin: any,
    ymin: any, 
    xmax: any, 
    ymax: any, 
    class: any, 
    name: any, 
    confidence: any
}
