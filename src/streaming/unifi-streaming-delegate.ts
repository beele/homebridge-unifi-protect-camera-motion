import {API, Logging} from 'homebridge';
import {ImageUtils} from "../utils/image-utils";
import {Canvas} from "canvas";
import {UnifiCamera} from "../unifi/unifi";

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    public static readonly instances: UnifiStreamingDelegate[] = [];
    public readonly cameraName: string
    public readonly cameraId: string;
    private camera: UnifiCamera;

    constructor(cameraId: string, cameraName: string, log: Logging, api: API, cameraConfig: object, videoProcessor: string) {
        super(log, cameraConfig, api, api.hap, videoProcessor, null);
        this.cameraId = cameraId;
    }

    public setCamera(camera: UnifiCamera): void {
        this.camera = camera;
    }

    //This is called by Homekit!
    public handleSnapshotRequest(request: any, callback: Function): void {
        this.logDebug('Handling snapshot request for Camera: ' + this.cameraName);

        if (!this.camera || !this.camera.lastDetectionSnapshot) {
            this.logDebug('Getting snapshot via FFmpeg');
            super.handleSnapshotRequest(request, callback);
        } else {
            this.logDebug('Returning annotated snapshot');
            const canvas: Canvas = ImageUtils.resizeCanvas(this.camera.lastDetectionSnapshot, request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg'));
        }
    }
}