import {API, HAP, Logging} from 'homebridge';
import {ImageUtils} from "../utils/image-utils";
import {Canvas} from "canvas";
import {UnifiCamera} from "../unifi/unifi";

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    public static readonly instances: UnifiStreamingDelegate[] = [];
    public readonly cameraName: string
    public readonly cameraId: string;
    private readonly logInfo: Function;
    private readonly logDebug: Function;
    private camera: UnifiCamera;

    constructor(cameraId: string, cameraName: string, infoLogger: Function, debugLogger: Function, api: API, cameraConfig: object, logging: Logging, videoProcessor: string) {
        super(logging, cameraConfig, api, api.hap, videoProcessor, null);

        this.logInfo = infoLogger;
        this.logDebug = debugLogger;

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