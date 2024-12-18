import { Canvas } from "canvas";
import { Logging } from "homebridge";

import { ProtectApi, ProtectEventAdd, ProtectEventPacket, ProtectNvrBootstrap } from "unifi-protect";
export class Unifi {

    private readonly config: UnifiConfig;
    private readonly log: Logging;

    private readonly unifiProtectApi: ProtectApi;

    private motionEventCallback: (event: UnifiMotionEvent) => Promise<void> | undefined;

    constructor(config: UnifiConfig, log: Logging) {
        this.config = config;
        this.log = log;

        this.unifiProtectApi = new ProtectApi(log);
    }

    public authenticate = async (username: string, password: string): Promise<void> => {
        if (!username || !password) {
            throw new Error('Username and password should be filled in!');
        }

        const bootstrapP = new Promise<void>(async (res, rej) => {
            this.unifiProtectApi.once("login", async (successful: boolean) => {
                if (!successful) {
                    rej(new Error('Could not log in!'));
                }

                if (!await this.unifiProtectApi.getBootstrap()) {
                    rej(new Error('Could not get bootstrap data!'));
                }
            });
            this.unifiProtectApi.once("bootstrap", (bootstrapJSON: ProtectNvrBootstrap) => {
                res();
            });

            if (!await this.unifiProtectApi.login(this.config.controller, username, password)) {
                rej(new Error('Could not log in!'));
            }
        });

        await bootstrapP;
        this.log.debug('Authenticated, returning session');
    }

    public enumerateMotionCameras = async (): Promise<UnifiCamera[]> => {
        this.log.debug('Cameras retrieved, enumerating motion sensors');

        const cams = this.unifiProtectApi.bootstrap.cameras;

        return cams.map((cam) => {
            if (this.config.debug) {
                //this.log.debug(JSON.stringify(cam, null, 4));
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
                supportsTwoWayAudio: cam.hasSpeaker && cam.speakerSettings.isEnabled,
                talkbackSettings: cam.talkbackSettings
            }
        });
    }

    public startMotionEventTracking = async (handler: (event: UnifiMotionEvent) => Promise<void>): Promise<void> => {
        this.motionEventCallback = handler;
        this.unifiProtectApi.on('message', this.onMessage);
    }

    private onMessage = async (event: ProtectEventPacket): Promise<void> => {
        switch (event.header.action) {
            case 'add':
                await this.onActionAdd(event as any satisfies ProtectEventPacketAddPayload);
                break;
            case 'update':
                break;
            case 'remove':
                break;
            default:
                this.log.warn('Unknown unifi event action: ' + event.header.action);
        }
    }

    private onActionAdd = async (event: ProtectEventPacketAddPayload): Promise<void> => {
        if (event.header.modelKey === 'event' && event.header.recordModel === 'camera') {
            this.log.debug(JSON.stringify(event, null, 4));

            let mappedEvent: UnifiMotionEvent | undefined;
            switch (event.payload.type) {
                case 'smartDetectZone':
                    mappedEvent = {
                        id: event.header.id,
                        cameraId: event.payload.camera,
                        camera: undefined,
                        score: event.payload.score,
                        timestamp: event.payload.start,
                    };
                    break;
                    case 'motion':
                        mappedEvent = {
                            id: event.header.id,
                            cameraId: event.payload.camera,
                            camera: undefined,
                            score: undefined,
                            timestamp: event.payload.start,
                        };
                        break;
                default:
                    // TODO: Implement other cases!
                    this.log.warn('Unknown payload type: ' + event.payload.type);
            }

            if (mappedEvent && this.motionEventCallback) {
                await this.motionEventCallback(mappedEvent);
            }
        }
    }

    public stopMotionEventTracking = (): void => {
        this.motionEventCallback = undefined;
        this.unifiProtectApi.off('message', this.onMessage);
    }

    public getSnapshotForCamera = async (camera: UnifiCamera, width: number, height: number): Promise<Buffer> => {
        const unifCam = this.unifiProtectApi.bootstrap.cameras.find((cam) => cam.id === camera.id);
        return await this.unifiProtectApi.getSnapshot(unifCam, { width, height });
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

type ProtectEventPacketAddPayload = Exclude<ProtectEventPacket, 'payload'> & { payload: ProtectEventAdd };

export interface UnifiCamera {
    id: string;
    uuid?: string | undefined;
    name: string;
    ip: string;
    mac: string;
    type: string;
    firmware: string;
    supportsTwoWayAudio: boolean;
    talkbackSettings: UnifiTalkbackSettings;
    streams: UnifiCameraStream[];
    lastMotionEvent?: UnifiMotionEvent;
    lastDetectionSnapshot?: Buffer;
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
    camera: UnifiCamera | undefined;
    score: number | undefined;
    timestamp: number;
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
    debug: boolean;
    debug_network_traffic: boolean;
}
