import {
    HAP,
    Logging
} from 'homebridge';

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    constructor(hap: HAP, cameraConfig: object, logging: Logging, videoProcessor: string) {
        super(hap, cameraConfig, logging, videoProcessor);
    }

    public handleSnapshotRequest(request: any, callback: Function): void {
        //TODO: Implement custom logic!
        console.log('Handling snapshot request for Unifi!');
        console.log(request);

        super.handleSnapshotRequest(request, callback);
    }
}