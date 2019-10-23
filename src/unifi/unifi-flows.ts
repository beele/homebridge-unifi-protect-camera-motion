import {Unifi, UnifiMotionEvent, UnifiCamera, UnifiSession, UnifiConfig} from "./unifi";

export class UnifiFlows {

    private readonly unifi: Unifi;
    private readonly config: UnifiConfig;
    private readonly log: any;

    private session: UnifiSession;

    constructor(unifi: Unifi, config: UnifiConfig, logger: Function) {
        this.unifi = unifi;
        this.config = config;
        this.log = logger;
    }

    public async enumerateCameras(): Promise<UnifiCamera[]> {
        try {
            await this.ensureSessionIsValid();
            return await this.unifi.enumerateMotionCameras(this.session);
        } catch (error) {
            throw new Error('ERROR: Could not enumerate motion sensors: ' + error);
        }
    }

    public async getMotionEvents(cameras: UnifiCamera[]): Promise<UnifiMotionEvent[]> {
        try {
            await this.ensureSessionIsValid();
            const motionEvents: UnifiMotionEvent[] = await this.unifi.getMotionEvents(this.session);
            const filteredMotionEvents: UnifiMotionEvent[] = [];

            //We only want one event per camera!
            outer: for (const camera of cameras) {
                for (const motionEvent of motionEvents) {
                    if (camera.id === motionEvent.cameraId) {
                        if (motionEvent.score >= this.config.motion_score) {
                            this.log('!!!! Unifi Motion event (' + motionEvent.id + ') accepted for camera: ' + camera.name + ' - Score: ' + motionEvent.score + ' !!!!');
                            motionEvent.camera = camera;
                            filteredMotionEvents.push(motionEvent);
                        } else {
                            this.log('!!!! Unifi Motion event  (' + motionEvent.id + ') rejected for camera: ' + camera.name + ' - Score: ' + motionEvent.score + ' !!!!');
                        }
                        continue outer;
                    }
                }
            }

            return filteredMotionEvents;
        } catch (error) {
            throw new Error('Could not detect motion: ' + error);
        }
    }

    private async ensureSessionIsValid(): Promise<UnifiSession> {
        try {
            if(!await this.unifi.isSessionStillValid(this.session)) {
                this.session = await this.unifi.authenticate(this.config.username, this.config.password);
            }
            return this.session;
        } catch (error) {
            throw new Error('Authentication failed: ' + JSON.stringify(error, null, 4));
        }
    }
}
