import {
    HAP,
    Logging
} from 'homebridge';
import {ImageUtils} from "../utils/image-utils";
import {Canvas} from "canvas";
import {UnifiCamera} from "./unifi";

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    private camera: UnifiCamera;

    constructor(hap: HAP, cameraConfig: object, logging: Logging, videoProcessor: string) {
        super(hap, cameraConfig, logging, videoProcessor);
    }

    public setCamera(camera: UnifiCamera): void {
        this.camera = camera;
    }

    //This will be called by Homekit!
    public handleSnapshotRequest(request: any, callback: Function): void {
        console.log('Handling snapshot request for Unifi!');
        console.log(request);

        if (!this.camera.lastDetectionSnapshot) {
            super.handleSnapshotRequest(request, callback);
        } else {
            //TODO: Implement custom logic!
            const canvas: Canvas = ImageUtils.createCanvasFromImageWithTargetWidthAndHeight(this.camera.lastDetectionSnapshot, request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg', { quality: 0.75 }));
        }
    }
}