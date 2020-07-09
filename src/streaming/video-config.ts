export interface VideoConfig {
    source: string;
    stillImageSource: string;
    maxStreams?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxFPS?: number;
    minBitrate?: number;
    maxBitrate?: number;
    preserveRatio?: string;
    vcodec?: string;
    audio?: string;
    packetSize?: number;
    vflip?: boolean;
    hflip?: boolean;
    mapvideo?: string;
    mapaudio?: string;
    videoFilter?: string;
    additionalCommandline?: string;
    debug?: boolean;
}