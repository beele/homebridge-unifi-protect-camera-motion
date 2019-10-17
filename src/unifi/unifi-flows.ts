import {Unifi, UnifiMotionEvent, UnifiCamera, UnifiSession} from "./unifi";

export class UnifiFlows {

    private readonly unifi: Unifi;
    private readonly username: string;
    private readonly password: string;
    private readonly log: any;

    private session: UnifiSession;

    constructor(unifi: Unifi, username: string, password: string, logger: any) {
        this.unifi = unifi;
        this.username = username;
        this.password = password;
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

    public async detectMotion(cameras: UnifiCamera[]): Promise<UnifiMotionEvent[]> {
        try {
            await this.ensureSessionIsValid();
            return await this.unifi.detectMotion(cameras, this.session);
        } catch (error) {
            throw new Error('Could not detect motion: ' + error);
        }
    }

    private async ensureSessionIsValid(): Promise<UnifiSession> {
        try {
            if(!await this.unifi.isSessionStillValid(this.session)) {
                this.session = await this.unifi.authenticate(this.username, this.password);
            }
            return this.session;
        } catch (error) {
            throw new Error('Authentication failed: ' + JSON.stringify(error, null, 4));
        }
    }
}
