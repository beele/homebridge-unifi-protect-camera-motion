export interface VideoConfig {
    source: string;
    stillImageSource: string;
    maxStreams?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxFPS?: number;
    maxBitrate?: number;
    forceMax?: boolean;
    vcodec?: string;
    audio?: string;
    packetSize?: number;
    mapvideo?: string;
    mapaudio?: string;
    videoFilter?: string;
    encoderOptions?: string;
    debug?: boolean;
}