import {
    HAP,
    Logging
} from 'homebridge';

const StreamingDelegate = require('homebridge-camera-ffmpeg/dist/streamingDelegate').StreamingDelegate;

export class UnifiStreamingDelegate extends StreamingDelegate {

    constructor(hap: HAP, cameraConfig: object, logging: Logging, videoProcessor: string) {
        super(hap, cameraConfig, logging, videoProcessor);
    }

    //This will be called by Homekit!
    public handleSnapshotRequest(request: any, callback: Function): void {
        console.log('Handling snapshot request for Unifi!');
        console.log(request);

        //TODO: Implement custom logic!
        //request.width;
        //request.height;
        //callback(undefined, imageBuffer);

        super.handleSnapshotRequest(request, callback);
    }
}