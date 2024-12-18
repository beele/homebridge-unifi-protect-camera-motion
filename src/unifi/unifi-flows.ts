import {Unifi, UnifiCamera, UnifiConfig, UnifiMotionEvent, UnifiSession} from "./unifi.js";
import {Logging} from "homebridge";

export class UnifiFlows {

    private readonly unifi: Unifi;
    private readonly config: UnifiConfig;
    private readonly log: Logging;

    constructor(unifi: Unifi, config: UnifiConfig,  logger: Logging) {
        this.unifi = unifi;
        this.config = config;
        this.log = logger;
    }

    public startMotionEventTracking = async (handler: (event: UnifiMotionEvent) => Promise<void>): Promise<void> => {
        await this.unifi.startMotionEventTracking(handler);
    }

    public enumerateCameras = async (): Promise<UnifiCamera[]> => {
        try {
            await this.unifi.authenticate(this.config.username, this.config.password);
            return await this.unifi.enumerateMotionCameras();
        } catch (error) {
            throw new Error('ERROR: Could not enumerate motion sensors: ' + error);
        }
    }

    public getCameraSnapshot = async (camera: UnifiCamera, width: number, height: number): Promise<Buffer> => {
        try {
            return this.unifi.getSnapshotForCamera(camera, width, height);
        } catch (error) {
            throw new Error('Could not get camera snapshot: ' + error);
        }
    }
}
