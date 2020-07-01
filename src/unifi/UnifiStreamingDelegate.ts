import {
    HAP,
    Logging
} from 'homebridge';
import {ImageUtils} from "../utils/image-utils";
import {Canvas} from "canvas";
import {UnifiCamera} from "./unifi";

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    private readonly camera: UnifiCamera;

    constructor(camera: UnifiCamera, hap: HAP, cameraConfig: object, logging: Logging, videoProcessor: string) {
        super(hap, cameraConfig, logging, videoProcessor);
        this.camera = camera;
    }

    //This will be called by Homekit!
    public handleSnapshotRequest(request: any, callback: Function): void {
        console.log('Handling snapshot request for Unifi!');
        console.log(request);

        if (!this.camera || !this.camera.lastDetectionSnapshot) {
            console.log('Handling with regular image!');
            super.handleSnapshotRequest(request, callback);
        } else {
            console.log('Handling with custom image!');
            const canvas: Canvas = ImageUtils.resizeCanvas(this.camera.lastDetectionSnapshot, request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg', { quality: 0.75 }));
        }
    }
}