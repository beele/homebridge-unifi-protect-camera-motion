import {Utils} from "../utils/utils";
import {Canvas} from "canvas";
import {Logging} from "homebridge";

import {Headers, Response} from "node-fetch";

export class Unifi {

    private readonly config: UnifiConfig;
    private readonly initialBackoffDelay: number;
    private readonly maxRetries: number;
    private readonly log: Logging;
    private readonly networkLogger: Logging;

    constructor(config: UnifiConfig, initialBackoffDelay: number, maxRetries: number, log: Logging) {
        this.config = config;
        this.initialBackoffDelay = initialBackoffDelay;
        this.maxRetries = maxRetries;

        this.log = log;
        this.networkLogger = this.config.debug_network_traffic ? this.log : undefined;
    }

    public static async determineEndpointStyle(baseControllerUrl: string, log: Logging): Promise<UnifiEndPointStyle> {
        if (baseControllerUrl && baseControllerUrl.endsWith('/')) {
            throw new Error('Controller URL should NOT end with a slash!');
        }

        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        const response: Response = await Utils.fetch(baseControllerUrl,
            {method: 'GET'},
            headers
        );

        const csrfToken = response.headers.get('X-CSRF-Token');
        if (csrfToken) {
            log.info('Endpoint Style: UnifiOS');
            return {
                authURL: baseControllerUrl + '/api/auth/login',
                apiURL: baseControllerUrl + '/proxy/protect/api',
                isUnifiOS: true,
                csrfToken: csrfToken
            }
        } else {
            log.info('Endpoint Style: Unifi Protect (Legacy)');
            return {
                authURL: baseControllerUrl + '/api/auth',
                apiURL: baseControllerUrl + '/api',
                isUnifiOS: false
            }
        }
    }

    public async authenticate(username: string, password: string, endpointStyle: UnifiEndPointStyle): Promise<UnifiSession> {
        if (!username || !password) {
            throw new Error('Username and password should be filled in!');
        }

        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (endpointStyle.isUnifiOS) {
            headers.set('X-CSRF-Token', endpointStyle.csrfToken);
        }

        const loginPromise: Promise<Response> = Utils.fetch(endpointStyle.authURL, {
            body: JSON.stringify({username: username, password: password}),
            method: 'POST'},
            headers, this.networkLogger
        );
        const response: Response = await Utils.retry(this.maxRetries, () => { return loginPromise }, this.initialBackoffDelay);

        this.log.debug('Authenticated, returning session');
        if (endpointStyle.isUnifiOS) {
            endpointStyle.csrfToken = response.headers.get('X-CSRF-Token');
            return {
                cookie: response.headers.get('Set-Cookie'),
                timestamp: Date.now()
            }
        } else {
            return {
                authorization: response.headers.get('Authorization'),
                timestamp: Date.now()
            }
        }
    }

    public isSessionStillValid(session: UnifiSession): boolean {
        // Validity duration for now set at 12 hours!
        if (session) {
            if ((session.timestamp + (12 * 3600 * 1000)) >= Date.now()) {
                return true;
            } else {
                this.log.debug('WARNING: Session expired, a new session must be created!');
            }
        } else {
            this.log.debug('WARNING: No previous session found, a new session must be created!');
        }
        return false;
    }

    public async enumerateMotionCameras(session: UnifiSession, endPointStyle: UnifiEndPointStyle): Promise<UnifiCamera[]> {
        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (endPointStyle.isUnifiOS) {
            headers.set('Cookie', session.cookie);
            headers.set('X-CSRF-Token', endPointStyle.csrfToken);
        } else {
            headers.set('Authorization', 'Bearer ' + session.authorization)
        }

        const bootstrapPromise: Promise<Response> = Utils.fetch(endPointStyle.apiURL + '/bootstrap',
            {method: 'GET'},
            headers, this.networkLogger
        );
        const response: Response = await Utils.retry(this.maxRetries, () => { return bootstrapPromise }, this.initialBackoffDelay);
        const cams = (await response.json()).cameras;

        this.log.debug('Cameras retrieved, enumerating motion sensors');

        return cams.map((cam: any) => {
            if (this.config.debug) {
                this.log.debug(cam);
            }

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

            // Sort streams on highest res!
            streams.sort((a: UnifiCameraStream, b: UnifiCameraStream): number => {
                return (a.height * a.width) - (b.height * b.width);
            });

            this.log.info('Found camera: ' + cam.name + ' (id: ' + cam.id + ')');
            return {
                id: cam.id,
                name: cam.name,
                ip: cam.host,
                mac: cam.mac,
                type: cam.type,
                firmware: cam.firmwareVersion,
                streams: streams
            }
        });
    }

    public async getMotionEvents(session: UnifiSession, endPointStyle: UnifiEndPointStyle): Promise<UnifiMotionEvent[]> {
        const endEpoch = Date.now();
        const startEpoch = endEpoch - (this.config.motion_interval * 2);

        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (endPointStyle.isUnifiOS) {
            headers.set('Cookie', session.cookie);
            headers.set('X-CSRF-Token', endPointStyle.csrfToken);
        } else {
            headers.set('Authorization', 'Bearer ' + session.authorization)
        }
        const eventsPromise: Promise<Response> = Utils.fetch(endPointStyle.apiURL + '/events?end=' + endEpoch + '&start=' + startEpoch + '&type=motion',
            {method: 'GET'},
            headers, this.networkLogger
        );
        const response: Response = await Utils.retry(this.maxRetries, () => { return eventsPromise }, this.initialBackoffDelay);

        const events: any[] = await response.json();
        return events.map((event: any) => {
            if (this.config.debug) {
                this.log.debug(event);
            }

            return {
                id: event.id,
                cameraId: event.camera,
                camera: null,
                score: event.score,
                timestamp: event.start // event.end is null when the motion is still ongoing!
            }
        });
    }

    public async getSnapshotForCamera(session: UnifiSession, endPointStyle: UnifiEndPointStyle, camera: UnifiCamera): Promise<Buffer> {
        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (endPointStyle.isUnifiOS) {
            headers.set('Cookie', session.cookie);
            headers.set('X-CSRF-Token', endPointStyle.csrfToken);
        } else {
            headers.set('Authorization', 'Bearer ' + session.authorization)
        }
        const eventsPromise: Promise<Response> = Utils.fetch(endPointStyle.apiURL + '/cameras/' + camera.id + '/snapshot/',
            {method: 'GET'},
            headers, this.networkLogger
        );
        // TODO: response is sometimes undefined! Hopefully rework of backoff/retry has fixed this issue!
        const response: Response = await Utils.retry(this.maxRetries, () => { return eventsPromise }, this.initialBackoffDelay);
        return response.buffer();
    }

    public static pickHighestQualityAlias(streams: UnifiCameraStream[]): string {
        return streams
            .map(((stream: UnifiCameraStream) => {
                return {
                    resolution: stream.width * stream.height,
                    alias: stream.alias
                };
            }))
            .sort((a, b) => {
                return a.resolution - b.resolution;
            })
            .shift().alias;
    }
}

export interface UnifiSession {
    authorization?: string;
    cookie?: string
    timestamp: number;
}

export interface UnifiCamera {
    id: string;
    uuid: string;
    name: string;
    ip: string;
    mac: string;
    type: string;
    firmware: string;
    streams: UnifiCameraStream[];
    lastMotionEvent?: UnifiMotionEvent;
    lastDetectionSnapshot?: Canvas;
}

export interface UnifiCameraStream {
    name: string;
    alias: string;
    width: number;
    height: number;
    fps: number;
}

export interface UnifiMotionEvent {
    id: string;
    cameraId: string;
    score: number;
    timestamp: number;
}

export interface UnifiEndPointStyle {
    authURL: string;
    apiURL: string;
    isUnifiOS: boolean;
    csrfToken?: string;
}

export interface UnifiConfig {
    controller: string;
    controller_rtsp: string;
    username: string;
    password: string;
    excluded_cameras: string[];
    motion_interval: number;
    motion_repeat_interval: number;
    motion_score: number;
    enhanced_motion: boolean;
    enhanced_motion_score: number;
    enhanced_classes: string[];
    enable_motion_trigger: boolean;
    enable_doorbell_for: string[];
    save_snapshot: boolean;
    upload_gphotos: boolean;
    debug: boolean;
    debug_network_traffic: boolean;
}