import {UnifiCamera, UnifiConfig, UnifiMotionEvent} from "../unifi/unifi";
import {Detection, Detector, Loader} from "../coco/loader";
import {UnifiFlows} from "../unifi/unifi-flows";
import {Image} from "canvas";

const path = require('path');

export class MotionDetector {

    private readonly homebridge: any;
    private readonly Service: any;
    private readonly Characteristic: any;

    private readonly config: UnifiConfig;
    private readonly flows: UnifiFlows;
    private readonly cameras: UnifiCamera[];
    private readonly log: Function;

    private detector: Detector;
    private configuredAccessories: any[];

    constructor(homebridge: any, unifiConfig: UnifiConfig, unifiFlows: UnifiFlows, cameras: UnifiCamera[], logger: Function) {
        this.homebridge = homebridge;
        this.Service = homebridge.hap.Service;
        this.Characteristic = homebridge.hap.Characteristic;

        this.config = unifiConfig;
        this.flows = unifiFlows;
        this.cameras = cameras;

        this.log = logger;

        this.detector = null;
    }

    public async setupMotionChecking(configuredAccessories: any[]): Promise<any> {
        this.configuredAccessories = configuredAccessories;

        let intervalFunction: Function;
        if (this.config.enhanced_motion) {
            this.detector = await Loader.loadCoco(false, path.dirname(require.resolve('homebridge-unifi-protect-camera-motion/package.json')));
            //this.detector = await Loader.loadCoco(false, '../');
            intervalFunction = this.checkMotionEnhanced.bind(this);
        } else {
            intervalFunction = this.checkMotion.bind(this);
        }

        setInterval(() => {
            try {
                intervalFunction();
            } catch (error) {
                this.log('Error during motion interval loop: ' + error);
            }
        }, this.config.motion_interval);
        return;
    }

    private async checkMotion(): Promise<any> {
        const motionEvents: UnifiMotionEvent[] = await this.flows.getLatestMotionEventPerCamera(this.cameras);

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 0);

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    if (this.isSkippableLongRunningMotion(configuredAccessory, motionEvent)) {
                        return;
                    }

                    this.log('!!!! Motion detected (' + motionEvent.score + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                    configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 1);

                    continue outer;
                }
            }
        }
    }

    private async checkMotionEnhanced(): Promise<any> {
        const motionEvents: UnifiMotionEvent[] = await this.flows.getLatestMotionEventPerCamera(this.cameras);

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 0);

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    let snapshot: Image;
                    try {
                        snapshot = await Loader.createImage('http://' + motionEvent.camera.ip + '/snap.jpeg');
                    } catch (error) {
                        continue;
                    }
                    const detections: Detection[] = await this.detector.detect(snapshot, this.config.debug);

                    for (const classToDetect of this.config.enhanced_classes) {
                        const detection: Detection = this.getDetectionForClassName(classToDetect, detections);

                        if (detection) {
                            if (this.isSkippableLongRunningMotion(configuredAccessory, motionEvent)) {
                                return;
                            }

                            const score: number = Math.round(detection.score * 100);
                            if (score >= this.config.enhanced_motion_score) {
                                this.log('!!!! ' + classToDetect +' detected (' + score + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                                configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 1);

                                if (this.config.save_snapshot) {
                                    await Loader.saveAnnotatedImage(snapshot, [detection]);
                                }

                                continue outer;
                            } else {
                                this.log('!!!! Detected class: ' + detection.class + ' rejected due to score: ' + score + '% (must be ' + this.config.enhanced_motion_score + '% or higher) !!!!');
                            }
                        } else {
                            console.log('None of the required classes found by enhanced motion detection, discarding!');
                        }
                    }
                }
            }
        }
    }

    private isSkippableLongRunningMotion(accessory: any, motionEvent: UnifiMotionEvent): boolean {
        //Prevent repeat motion notifications for motion events that are longer then the motion_interval config setting!
        if (this.config.motion_repeat_interval) {
            if (accessory.context.lastMotionId === motionEvent.id) {
                accessory.context.lastMotionIdRepeatCount++;

                if (accessory.context.lastMotionIdRepeatCount === (this.config.motion_repeat_interval / this.config.motion_interval)) {
                    accessory.context.lastMotionIdRepeatCount = 0;
                } else {
                    this.log('Motion detected inside of skippable timeframe, ignoring!');
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
            if(detection.class.toLowerCase() === className.toLowerCase()) {
                return detection;
            }
        }
        return null;
    }
}
