import {Unifi, UnifiCamera, UnifiConfig, UnifiEndPointStyle, UnifiMotionEvent, UnifiSession} from "./unifi";
import {Logging} from "homebridge";

export class UnifiFlows {

    private readonly unifi: Unifi;
    private readonly config: UnifiConfig;
    private readonly endpointStyle: UnifiEndPointStyle;
    private readonly log: Logging;

    private session: UnifiSession;

    constructor(unifi: Unifi, config: UnifiConfig, endPointStyle: UnifiEndPointStyle, logger: Logging) {
        this.unifi = unifi;
        this.config = config;
        this.endpointStyle = endPointStyle;
        this.log = logger;
    }

    public async enumerateCameras(): Promise<UnifiCamera[]> {
        try {
            await this.ensureSessionIsValid();
            return await this.unifi.enumerateMotionCameras(this.session, this.endpointStyle);
        } catch (error) {
            throw new Error('ERROR: Could not enumerate motion sensors: ' + error);
        }
    }

    public async assignMotionEventsToCameras(cameras: UnifiCamera[]): Promise<UnifiCamera[]> {
        try {
            await this.ensureSessionIsValid();
            const motionEvents: UnifiMotionEvent[] = await this.unifi.getMotionEvents(this.session, this.endpointStyle);

            outer: for (const camera of cameras) {
                camera.lastMotionEvent = null;

                for (const motionEvent of motionEvents) {
                    if (camera.id === motionEvent.cameraId) {
                        if (motionEvent.score >= this.config.motion_score) {
                            this.log.debug('Unifi Motion event (' + motionEvent.id + ') accepted for camera: ' + camera.name + ' - Score: ' + motionEvent.score);
                            camera.lastMotionEvent = motionEvent;
                        } else {
                            this.log.debug('Unifi Motion event (' + motionEvent.id + ') rejected for camera: ' + camera.name + ' - Score: ' + motionEvent.score);
                        }
                        continue outer;
                    }
                }
            }

            return cameras;
        } catch (error) {
            throw new Error('Could not detect motion: ' + error);
        }
    }

    private async ensureSessionIsValid(): Promise<UnifiSession> {
        try {
            if (!await this.unifi.isSessionStillValid(this.session)) {
                this.session = await this.unifi.authenticate(this.config.username, this.config.password, this.endpointStyle);
            }
            return this.session;
        } catch (error) {
            throw new Error('Authentication failed: ' + JSON.stringify(error, null, 4));
        }
    }
}
