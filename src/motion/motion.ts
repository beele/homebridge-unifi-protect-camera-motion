import {UnifiCamera, UnifiConfig, UnifiMotionEvent} from "../unifi/unifi";
import {Detection, Detector, Loader} from "../coco/loader";
import {UnifiFlows} from "../unifi/unifi-flows";
import {Image} from "canvas";

export class MotionDetector {

    private homebridge: any;
    private Service: any;
    private Characteristic: any;

    private config: UnifiConfig;
    private flows: UnifiFlows;
    private cameras: UnifiCamera[];
    private detector: Detector;
    private log: Function;

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
            //this.detector = await Loader.loadCoco(false, path.dirname(require.resolve('homebridge-unifi-protect-camera-motion/package.json')));
            this.detector = await Loader.loadCoco(false, '../');
            intervalFunction = this.checkMotionEnhanced.bind(this);
        } else {
            intervalFunction = this.checkMotion.bind(this);
        }
        setInterval(intervalFunction, this.config.motion_interval);
        return;
    }

    private async checkMotion(): Promise<any> {
        const motionEvents: UnifiMotionEvent[] = await this.flows.detectMotion(this.cameras);

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 0);

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    console.log('!!!! Motion detected (' + motionEvent.score + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                    configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 1);

                    continue outer;
                }
            }
        }
    }

    private async checkMotionEnhanced(): Promise<any> {
        const motionEvents: UnifiMotionEvent[] = await this.flows.detectMotion(this.cameras);

        outer: for (const configuredAccessory of this.configuredAccessories) {
            configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 0);

            for (const motionEvent of motionEvents) {
                if (motionEvent.camera.id === configuredAccessory.context.id) {
                    if (this.config.debug) {
                        console.log('Motion detected, running CoCo object detection...');
                    }

                    const snapshot: Image = await Loader.createImage('http://' + motionEvent.camera.ip + '/snap.jpeg');
                    const detections: Detection[] = await this.detector.detect(snapshot, this.config.debug);

                    for (const classToDetect of this.config.enhanced_classes) {
                        const detection: Detection = this.getDetectionForClassName(classToDetect, detections);

                        if (detection) {
                            console.log('!!!! ' + classToDetect +' detected (' + Math.round(detection.score * 100) + '%) by camera ' + motionEvent.camera.name + ' !!!!');
                            configuredAccessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, 1);
                            Loader.saveAnnotatedImage(snapshot, [detection]);

                            continue outer;
                        }
                    }

                    continue outer;
                }
            }
        }

        //TODO: Error handling!
        // console.log('Error with enhanced detection: ' + error);
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
