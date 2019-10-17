import {Utils} from "../utils/utils";

const request = require('request-promise-native');

export class Unifi {

    private readonly controller: string;
    private readonly motionScore: number;
    private readonly motionIntervaldelay: number;

    private readonly initialBackoffDelay: number;
    private readonly maxRetries: number;

    private readonly log: any;

    constructor(controller: string, motionScore: number, motionIntervalDelay: number, initialBackoffDelay: number, maxRetries: number, logger: any) {
        this.controller = controller;
        this.motionScore = motionScore;
        this.motionIntervaldelay = motionIntervalDelay;

        this.initialBackoffDelay = initialBackoffDelay;
        this.maxRetries = maxRetries;

        this.log = logger;
    }

    public async authenticate(username: string, password: string): Promise<UnifiSession> {
        if (!username || !password) {
            throw new Error('Username and password should be filled in!');
        }

        const opts = {
            uri: this.controller + '/api/auth',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                "username": username,
                "password": password
            },
            json: true,
            strictSSL: false,
            resolveWithFullResponse: true,
            timeout: 1000
        };

        const response: any = await Utils.backoff(this.maxRetries, request.post(opts), this.initialBackoffDelay);
        Utils.checkResponseForErrors(response, 'headers', ['authorization']);

        this.log('Authenticated, returning session');
        const authorization = response.headers['authorization'];
        return {
            authorization,
            timestamp: Date.now()
        };
    }

    public isSessionStillValid(session: UnifiSession): boolean {
        //Validity duration for now set at 12 hours!
        if (session) {
            if ((session.timestamp + (12 * 3600 * 1000)) >= Date.now()) {
                return true;
            } else {
                this.log('WARNING: Session expired, a new session must be created!');
            }
        } else {
            this.log('WARNING: No previous session found, a new session must be created!');
        }
        return false;
    }

    public async enumerateMotionCameras(session: UnifiSession): Promise<UnifiCamera[]> {
        const opts = {
            uri: this.controller + '/api/bootstrap',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + session.authorization
            },
            json: true,
            strictSSL: false,
            resolveWithFullResponse: true,
            timeout: 1000
        };

        const response: any = await Utils.backoff(this.maxRetries, request.get(opts), this.initialBackoffDelay);
        Utils.checkResponseForErrors(response, 'body',['cameras']);

        this.log('Cameras retrieved, enumerating motion sensors');
        const cams = response.body.cameras;

        const sensors: UnifiCamera[] = [];
        for (const cam of cams) {
            const streams: UnifiCameraStream[] = [];
            for (const channel of cam.channels) {
                if (channel.rtspAlias) {
                    streams.push({
                        name: channel.name,
                        alias: channel.rtspAlias,
                        width: channel.width,
                        height: channel.height,
                        fps: channel.fps
                    });
                }
            }

            const sensor: UnifiCamera = {
                id: cam.id,
                name: cam.name,
                ip: cam.host,
                mac: cam.mac,
                type: cam.type,
                firmware: cam.firmwareVersion,
                streams: streams
            };
            sensors.push(sensor);
        }
        return sensors;
    }

    public async detectMotion(cameras: UnifiCamera[], session: UnifiSession): Promise<UnifiMotionEvent[]> {
        const endEpoch = Date.now();
        const startEpoch = endEpoch - (this.motionIntervaldelay * 2);

        const opts = {
            uri: this.controller + '/api/events?end=' + endEpoch + '&start=' + startEpoch + '&type=motion',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + session.authorization
            },
            json: true,
            strictSSL: false,
            resolveWithFullResponse: true,
            timeout: 1000
        };

        const response: any = await Utils.backoff(this.maxRetries, request.get(opts), this.initialBackoffDelay);
        Utils.checkResponseForErrors(response, 'body');

        const events: any[] = response.body;
        const motionEvents: UnifiMotionEvent[] = [];

        outer: for (const camera of cameras) {
            for (const event of events) {

                if (camera.id === event.camera) {
                    if (event.score >= this.motionScore) {
                        //this.log('Motion detected! for camera: ' + camera.name + ' - Score: ' + event.score);
                        motionEvents.push({
                            camera,
                            score: event.score,
                            timestamp: event.start //event.end is null when the motion is still ongoing!
                        });
                    } else {
                        this.log('Motion rejected! for camera: ' + camera.name + ' - Score: ' + event.score);
                    }
                    continue outer;
                }
            }
        }

        return motionEvents;
    }
}

export interface UnifiSession {
    authorization: any;
    timestamp: number;
}

export interface UnifiCamera {
    id: string;
    name: string;
    ip: string;
    mac: string;
    type: string;
    firmware: string;
    streams: UnifiCameraStream[];
}

export interface UnifiCameraStream {
    name: string;
    alias: string;
    width: number;
    height: number;
    fps: number;
}

export interface UnifiMotionEvent {
    camera: UnifiCamera;
    score: number;
    timestamp: number;
}
