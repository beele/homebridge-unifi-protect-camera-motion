import {API, Logging, SnapshotRequest, SnapshotRequestCallback} from 'homebridge';
import {ImageUtils} from "../utils/image-utils";
import {Canvas} from "canvas";
import {UnifiCamera} from "../unifi/unifi";
import {UnifiFlows} from "../unifi/unifi-flows";

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    public static readonly instances: UnifiStreamingDelegate[] = [];
    public static uFlows: UnifiFlows;

    public readonly cameraName: string
    public readonly cameraId: string;
    private camera: UnifiCamera;
    private readonly log: Logging;

    constructor(cameraId: string, cameraName: string, log: Logging, api: API, cameraConfig: object, videoProcessor: string) {
        super(log, cameraConfig, api, api.hap, videoProcessor, null);
        this.cameraId = cameraId;
        this.cameraName = cameraName;
        this.log = log;
    }

    public setCamera(camera: UnifiCamera): void {
        this.camera = camera;
    }

    //This is called by Homekit!
    public handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
        this.log.debug('Handling snapshot request for Camera: ' + this.cameraName);

        if (!this.camera || !this.camera.lastDetectionSnapshot) {
            this.log.debug('Getting new snapshot');

            UnifiStreamingDelegate.uFlows.getCameraSnapshot(this.camera, request.width, request.height)
                .then((snapshot: Buffer) => {
                    callback(undefined, snapshot);
                })
                .catch((error) => {
                    callback(undefined, null);
                });
        } else {
            this.log.debug('Returning annotated snapshot');
            const canvas: Canvas = ImageUtils.resizeCanvas(this.camera.lastDetectionSnapshot, request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg'));
        }
    }
}