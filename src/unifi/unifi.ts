import {Utils} from "../utils/utils";
import {AxiosInstance, AxiosRequestConfig, AxiosResponse} from "axios";
import * as https from "https";
import {Canvas} from "canvas";

const axios = require('axios').default;

export class Unifi {

    private static readonly axiosInstance: AxiosInstance = axios.create({
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        })
    });
    private readonly config: UnifiConfig;
    private readonly initialBackoffDelay: number;
    private readonly maxRetries: number;
    private readonly logDebug: any;
    private readonly axiosInstance: AxiosInstance;

    constructor(config: UnifiConfig, initialBackoffDelay: number, maxRetries: number, debugLogger: Function) {
        this.config = config;
        this.initialBackoffDelay = initialBackoffDelay;
        this.maxRetries = maxRetries;

        this.logDebug = debugLogger;

        this.axiosInstance = axios.create({
            withCredentials: true,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });

        if (this.config.debug_network_traffic) {
            this.axiosInstance.interceptors.request.use((request: AxiosRequestConfig) => {
                this.logDebug(request);
                return request;
            });

            this.axiosInstance.interceptors.response.use((response: AxiosResponse) => {
                this.logDebug(response);
                return response;
            });
        }
    }

    public static async determineEndpointStyle(baseControllerUrl: string, log: Function): Promise<UnifiEndPointStyle> {
        const opts: AxiosRequestConfig = {
            url: baseControllerUrl,
            method: 'get',
            responseType: 'json',
            timeout: 1000
        };

        const response: AxiosResponse = await Unifi.axiosInstance.request(opts);
        if (response.headers['x-csrf-token']) {
            log('Endpoint Style: UnifiOS');
            return {
                authURL: baseControllerUrl + '/api/auth/login',
                apiURL: baseControllerUrl + '/proxy/protect/api',
                isUnifiOS: true,
                csrfToken: response.headers['x-csrf-token']
            }
        } else {
            log('Endpoint Style: Unifi Protect (Legacy)');
            return {
                authURL: baseControllerUrl + '/api/auth',
                apiURL: baseControllerUrl + '/api',
                isUnifiOS: false
            }
        }
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

    public async authenticate(username: string, password: string, endpointStyle: UnifiEndPointStyle): Promise<UnifiSession> {
        if (!username || !password) {
            throw new Error('Username and password should be filled in!');
        }

        const opts: AxiosRequestConfig = {
            url: endpointStyle.authURL,
            method: 'post',
            headers: endpointStyle.isUnifiOS ?
                {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': endpointStyle.csrfToken
                } : {
                    'Content-Type': 'application/json'
                },
            data: {
                "username": username,
                "password": password
            },
            responseType: 'json',
            withCredentials: true,
            timeout: 1000
        };

        //TODO: Remove, For debugging!
        console.log(JSON.stringify(opts, null, 4));

        const response: AxiosResponse = await Utils.backOff(this.maxRetries, this.axiosInstance.request(opts), this.initialBackoffDelay);

        //TODO: Remove, For debugging!
        console.log(response.status);
        console.log(response.statusText);
        console.log(JSON.stringify(response.data, null, 4));

        Utils.checkResponseForErrors(response, 'headers', [endpointStyle.isUnifiOS ? 'set-cookie' : 'authorization']);

        this.logDebug('Authenticated, returning session');
        if (endpointStyle.isUnifiOS) {
            return {
                cookie: response.headers['set-cookie']['0'],
                timestamp: Date.now()
            }
        } else {
            return {
                authorization: response.headers['authorization'],
                timestamp: Date.now()
            }
        }
    }

    //TODO: Is checking for expired session still needed with unifiOS?
    public isSessionStillValid(session: UnifiSession): boolean {
        //Validity duration for now set at 12 hours!
        if (session) {
            if ((session.timestamp + (12 * 3600 * 1000)) >= Date.now()) {
                return true;
            } else {
                this.logDebug('WARNING: Session expired, a new session must be created!');
            }
        } else {
            this.logDebug('WARNING: No previous session found, a new session must be created!');
        }
        return false;
    }

    public async enumerateMotionCameras(session: UnifiSession, endPointStyle: UnifiEndPointStyle): Promise<UnifiCamera[]> {
        const opts: AxiosRequestConfig = {
            url: endPointStyle.apiURL + '/bootstrap',
            method: 'get',
            headers: endPointStyle.isUnifiOS ?
                {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': endPointStyle.csrfToken,
                    'Cookie': session.cookie
                } : {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + session.authorization
                },
            responseType: 'json',
            timeout: 1000
        };

        //TODO: Remove, For debugging!
        console.log(JSON.stringify(opts, null, 4));

        const response: AxiosResponse = await Utils.backOff(this.maxRetries, this.axiosInstance.request(opts), this.initialBackoffDelay);

        //TODO: Remove, For debugging!
        console.log(response.status);
        console.log(response.statusText);
        console.log(JSON.stringify(response.data, null, 4));

        Utils.checkResponseForErrors(response, 'data', ['cameras']);

        this.logDebug('Cameras retrieved, enumerating motion sensors');
        const cams = response.data.cameras;

        return cams.map((cam: any) => {
            if (this.config.debug) {
                this.logDebug(cam);
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

            //Sort streams on highest res!
            streams.sort((a: UnifiCameraStream, b: UnifiCameraStream): number => {
                return (a.height * a.width) - (b.height * b.width);
            });

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

        const opts: AxiosRequestConfig = {
            url: endPointStyle.apiURL + '/events?end=' + endEpoch + '&start=' + startEpoch + '&type=motion',
            method: 'get',
            headers: endPointStyle.isUnifiOS ?
                {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': endPointStyle.csrfToken,
                    'Cookie': session.cookie
                } : {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + session.authorization
                },
            responseType: 'json',
            timeout: 1000
        };

        const response: AxiosResponse = await Utils.backOff(this.maxRetries, this.axiosInstance.request(opts), this.initialBackoffDelay);
        Utils.checkResponseForErrors(response, 'data');

        const events: any[] = response.data;
        return events.map((event: any) => {
            if (this.config.debug) {
                this.logDebug(event);
            }

            return {
                id: event.id,
                cameraId: event.camera,
                camera: null,
                score: event.score,
                timestamp: event.start //event.end is null when the motion is still ongoing!
            }
        });
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
    motion_interval: number;
    motion_repeat_interval: number;
    motion_score: number;
    enhanced_motion: boolean;
    enhanced_motion_score: number;
    enhanced_classes: string[];
    save_snapshot: boolean;
    enable_motion_trigger: boolean;
    enable_doorbell: boolean;
    debug: boolean;
    debug_network_traffic: boolean;
}