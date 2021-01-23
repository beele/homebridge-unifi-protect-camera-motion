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
        // Validity duration for Unifi OS is 1 hour
        if (session) {
            if ((session.timestamp + (1 * 3600 * 1000)) >= Date.now()) {
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
                streams: streams,
                supportsTwoWayAudio: cam.hasSpeaker &&  cam.speakerSettings.isEnabled,
                talkbackSettings: cam.talkbackSettings
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

    public async getSnapshotForCamera(session: UnifiSession, endPointStyle: UnifiEndPointStyle, camera: UnifiCamera, width: number, height: number): Promise<Buffer> {
        const headers: Headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (endPointStyle.isUnifiOS) {
            headers.set('Cookie', session.cookie);
            headers.set('X-CSRF-Token', endPointStyle.csrfToken);
        } else {
            headers.set('Authorization', 'Bearer ' + session.authorization)
        }

        const params = new URLSearchParams({ force: "true", width: width as any, height: height as any });
        const response: Response = await Utils.fetch(endPointStyle.apiURL + '/cameras/' + camera.id + '/snapshot/?' + params,
            {
                method: 'GET'
            },
            headers, this.networkLogger
        );

        if (!response?.ok) {
            this.log.debug(JSON.stringify(response, null, 4));
            throw new Error('Could not get snapshot for ' + camera.name);
        }
        return response.buffer();
    }

    public static generateStreamingUrlForBestMatchingResolution(baseSourceUrl: string, streams: UnifiCameraStream[], requestedWidth: number, requestedHeight: number): string {
        const targetResolution: number = requestedWidth * requestedHeight;
        const selectedAlias: string = streams
            .map(((stream: UnifiCameraStream) => {
                return {
                    resolution: stream.width * stream.height,
                    alias: stream.alias
                };
            }))
            .filter((data: { alias: string; resolution: number }) => {
                return data.resolution <= targetResolution;
            })
            .sort((a, b) => {
                return b.resolution - a.resolution;
            })
            .shift().alias;
        return baseSourceUrl + selectedAlias;
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
    supportsTwoWayAudio: boolean;
    talkbackSettings: UnifiTalkbackSettings;
    streams: UnifiCameraStream[];
    lastMotionEvent?: UnifiMotionEvent;
    lastDetectionSnapshot?: Canvas;
}

export interface UnifiTalkbackSettings {
    typeFmt: string;
    typeIn: string;
    bindAddr: string;
    bindPort: number;
    filterAddr: string;
    filterPort: number;
    channels: number;
    samplingRate: number;
    bitsPerSample: number;
    quality: number;
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
