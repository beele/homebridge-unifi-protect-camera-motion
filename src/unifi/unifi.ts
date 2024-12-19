import { Logging } from "homebridge";

import { ProtectApi, ProtectEventAdd, ProtectEventPacket, ProtectLivestream, ProtectNvrBootstrap } from "unifi-protect";
export class Unifi {

    private readonly log: Logging;
    private readonly config: UnifiConfig;

    private readonly unifiProtectApi: ProtectApi;

    private bootstrapData: Promise<ProtectNvrBootstrap>;
    private bootstrapDataResolver!: Function;

    private motionEventCallback: ((event: UnifiMotionEvent) => Promise<void>) | undefined;

    constructor(config: UnifiConfig, log: Logging) {
        this.log = log;
        this.config = config;

        this.bootstrapData = new Promise((res, rej) => {
            this.bootstrapDataResolver = res;
        });

        this.unifiProtectApi = new ProtectApi(log);
    }

    public authenticate = async (): Promise<void> => {
        if (!this.config.username || !this.config.password) {
            throw new Error('Username and password should be filled in!');
        }

        const loginAndBootstrap = new Promise<void>(async (res, rej) => {
            this.unifiProtectApi.once("login", async (successful: boolean) => {
                if (!successful) {
                    rej(new Error('Could not log in!'));
                }

                if (!await this.unifiProtectApi.getBootstrap()) {
                    rej(new Error('Could not get bootstrap data!'));
                }
            });
            this.unifiProtectApi.once("bootstrap", (bootstrapJSON: ProtectNvrBootstrap) => {
                this.bootstrapDataResolver(bootstrapJSON);
                res();
            });

            if (!await this.unifiProtectApi.login(this.config.controller, this.config.username, this.config.password)) {
                rej(new Error('Could not log in!'));
            }
        });

        await loginAndBootstrap;
        this.log.debug('Authenticated, returning session');
    }

    public enumerateMotionCameras = async (): Promise<UnifiCamera[]> => {
        this.log.debug('Cameras retrieved, enumerating motion sensors');

        await this.bootstrapData;
        const cams = this.unifiProtectApi.bootstrap?.cameras ?? [];

        return cams.map((cam) => {
            if (this.config.debug) {
                this.log.debug(JSON.stringify(cam, null, 4));
            }

            const streams: UnifiCameraStream[] = [];
            streams.push(
                ...cam.channels
                    .filter((channel) => channel.rtspAlias)
                    .map((channel) => {
                        return {
                            id: channel.id,
                            name: channel.name,
                            alias: channel.rtspAlias,
                            width: channel.width,
                            height: channel.height,
                            fps: channel.fps,
                            bitrate: channel.bitrate,
                            url: this.config.controller_rtsp + '/' + channel.rtspAlias
                        }
                    })
            );

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
                online: cam.isConnected,

                type: cam.type,
                firmware: cam.firmwareVersion,
   
                videoCodec: cam.videoCodec,
                audioCodec: cam.featureFlags.audioCodecs.at(0) ?? '', // TODO: Is this correct?
            
                audioRecordingEnabled: cam.featureFlags.hasMic && cam.isMicEnabled,
                supportsTwoWayAudio: cam.hasSpeaker && cam.speakerSettings.isEnabled,
                talkbackSettings: cam.talkbackSettings,

                streams: streams,
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

    public getSnapshotForCamera = async (camera: UnifiCamera, width: number, height: number): Promise<Buffer | undefined> => {
        const unifCam = this.unifiProtectApi.bootstrap?.cameras.find((cam) => cam.id === camera.id);
        if (!unifCam) {
            return;
        }

        return (await this.unifiProtectApi.getSnapshot(unifCam, { width, height })) ?? undefined;
    }

    public getWsEndpoint = async (endpoint: "livestream" | "talkback", params: URLSearchParams): Promise<string | null> => {
        return await this.unifiProtectApi.getWsEndpoint(endpoint, params)
    }

    public createLivestream = (): ProtectLivestream => {
        return this.unifiProtectApi.createLivestream();
    }

    public static getBestMatchingStream(streams: UnifiCameraStream[], requestedWidth: number, requestedHeight: number): UnifiCameraStream | undefined {
        const targetResolution: number = requestedWidth * requestedHeight;

        const sortedStreams = streams
            .sort((a, b) => {
                return b.width * b.height - a.width * a.height;
            });

        return sortedStreams
            .filter((stream) => {
                return stream.width * stream.height <= targetResolution;
            })
            .at(0);
    }
}

type ProtectEventPacketAddPayload = Exclude<ProtectEventPacket, 'payload'> & { payload: ProtectEventAdd };

export type UnifiCamera = {
    uuid?: string | undefined;

    id: string;
    name: string;

    ip: string;
    mac: string;
    online: boolean;

    type: string;
    firmware: string;

    videoCodec: string;
    audioCodec: string;

    audioRecordingEnabled: boolean;
    supportsTwoWayAudio: boolean;
    talkbackSettings: UnifiTalkbackSettings;

    streams: UnifiCameraStream[];

    lastMotionEvent?: UnifiMotionEvent;
    lastDetectionSnapshot?: Buffer;
}

export type UnifiTalkbackSettings = {
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

export type UnifiCameraStream = {
    id: number;
    name: string;
    alias: string;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    url: string;
}

export type UnifiMotionEvent = {
    id: string;
    cameraId: string;
    camera: UnifiCamera | undefined;
    score: number | undefined;
    timestamp: number;
}

export type UnifiConfig = {
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
