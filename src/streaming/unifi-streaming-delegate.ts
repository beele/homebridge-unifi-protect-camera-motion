/* Copyright(C) 2017-2020, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * protect-stream.ts: Homebridge camera streaming delegate implementation for Protect.
 *
 * This module is heavily inspired by the homebridge and homebridge-camera-ffmpeg source code and
 * borrows heavily from both. Thank you for your contributions to the HomeKit world.
 *
 * Adjusted by Kevin Van den Abeele
 */
import {
    API,
    AudioStreamingCodecType,
    AudioStreamingSamplerate,
    CameraController,
    CameraControllerOptions,
    CameraStreamingDelegate,
    HAP,
    Logging,
    PrepareStreamCallback,
    PrepareStreamRequest,
    PrepareStreamResponse,
    SnapshotRequest,
    SnapshotRequestCallback,
    SRTPCryptoSuites,
    StartStreamRequest,
    StreamingRequest,
    StreamRequestCallback,
    StreamRequestTypes
} from 'homebridge';
import { ImageUtils } from '../utils/image-utils';
import { Canvas } from 'canvas';
import { Unifi, UnifiCamera } from '../unifi/unifi';
import { UnifiFlows } from '../unifi/unifi-flows';
import { FfmpegProcess } from './ffmpeg-process';
import { RtpDemuxer, RtpUtils } from './rtp-splitter';
import { CameraConfig } from './camera-config';
import ffmpegPath from 'ffmpeg-for-homebridge';

type SessionInfo = {
    address: string; // Address of the HAP controller.
    addressVersion: string;

    videoPort: number;
    videoReturnPort: number;
    videoCryptoSuite: SRTPCryptoSuites; // This should be saved if multiple suites are supported.
    videoSRTP: Buffer; // Key and salt concatenated.
    videoSSRC: number; // RTP synchronisation source.

    hasLibFdk: boolean; // Does the user have a version of ffmpeg that supports AAC?
    audioPort: number;
    audioIncomingRtcpPort: number;
    audioIncomingRtpPort: number; // Port to receive audio from the HomeKit microphone.
    rtpDemuxer: RtpDemuxer | null; // RTP demuxer needed for two-way audio.
    audioCryptoSuite: SRTPCryptoSuites;
    audioSRTP: Buffer;
    audioSSRC: number;
};

export class UnifiStreamingDelegate implements CameraStreamingDelegate {

    public static uFlows: UnifiFlows;

    private readonly api: API;
    private readonly hap: HAP;
    public readonly log: Logging;

    private readonly cameraConfig;
    private readonly camera: UnifiCamera;
    public readonly cameraName: string;
    public readonly videoProcessor: string;

    private readonly ongoingSessions: { [index: string]: { ffmpeg: FfmpegProcess[], rtpDemuxer: RtpDemuxer | null } };
    private readonly pendingSessions: { [index: string]: SessionInfo };

    public controller: CameraController;

    constructor(camera: UnifiCamera, log: Logging, api: API, cameraConfig: CameraConfig, videoProcessor: string | undefined) {
        this.camera = camera;
        this.cameraName = camera.name;

        this.api = api;
        this.hap = api.hap;
        this.log = log;
        this.ongoingSessions = {};
        this.pendingSessions = {};
        this.videoProcessor = videoProcessor ?? ffmpegPath.ffmpeg_for_homebridge ?? 'ffmpeg';
        log.info('VIDEO PROCESSOR: ' + this.videoProcessor);

        this.cameraConfig = cameraConfig;

        // Setup for our camera controller.
        const options: CameraControllerOptions = {
            cameraStreamCount: 10, // HomeKit requires at least 2 streams, and HomeKit Secure Video requires 1.
            delegate: this,
            streamingOptions: {
                audio: {
                    codecs: [
                        {
                            samplerate: AudioStreamingSamplerate.KHZ_16,
                            type: AudioStreamingCodecType.AAC_ELD
                        }
                    ],

                    twoWayAudio: this.camera.supportsTwoWayAudio
                },

                supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],

                video: {
                    codec: {
                        // Through admittedly anecdotal testing on various G3 and G4 models, UniFi Protect seems to support
                        // only the H.264 Main profile, though it does support various H.264 levels, ranging from Level 3
                        // through Level 5.1 (G4 Pro at maximum resolution). However, HomeKit only supports Level 3.1, 3.2,
                        // and 4.0 currently.
                        levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0],
                        profiles: [this.hap.H264Profile.MAIN]
                    },

                    //TODO: Rework this!
                    resolutions: [
                        // Width, height, framerate.
                        [1920, 1080, 30],
                        [1280, 960, 30],
                        [1280, 720, 30],
                        [1024, 768, 30],
                        [640, 480, 30],
                        [640, 360, 30],
                        [480, 360, 30],
                        [480, 270, 30],
                        [320, 240, 30],
                        [320, 240, 15],   // Apple Watch requires this configuration
                        [320, 180, 30]
                    ]
                }
            }
        };

        this.controller = new this.hap.CameraController(options);
    }

    // HomeKit image snapshot request handler.
    public async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
        this.log.debug('Handling snapshot request for Camera: ' + this.camera.name);

        if (!this.camera || !this.camera.lastDetectionSnapshot) {
            this.log.debug('Getting new snapshot');

            try {
                const snapshotData: Buffer = await UnifiStreamingDelegate.uFlows.getCameraSnapshot(this.camera, request.width, request.height)
                callback(undefined, snapshotData);
            } catch (error) {
                callback(undefined, null);
            }
        } else {
            this.log.debug('Returning annotated snapshot');
            const canvas: Canvas = ImageUtils.resizeCanvas(this.camera.lastDetectionSnapshot, request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg'));
        }
    }

    public async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
        switch (request.type) {
            case StreamRequestTypes.START:
                this.startStream(request, callback);
                break;

            case StreamRequestTypes.RECONFIGURE:
                this.log.debug('%s: Ignoring request to reconfigure: %sx%s, %s fps, %s kbps.', this.camera.name, request.video.width, request.video.height, request.video.fps, request.video.max_bit_rate);
                callback();
                break;

            case StreamRequestTypes.STOP:
            default:
                this.stopStream(request.sessionID);
                callback();
                break;
        }
    }

    private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {

        const sessionInfo = this.pendingSessions[request.sessionID];
        const sdpIpVersion = sessionInfo.addressVersion === 'ipv6' ? 'IP6 ' : 'IP4';

        // Set our packet size to be 564. Why? MPEG transport stream (TS) packets are 188 bytes in size each.
        // These packets transmit the video data that you ultimately see on your screen and are transmitted using
        // UDP. Each UDP packet is 1316 bytes in size, before being encapsulated in IP. We want to get as many
        // TS packets as we can, within reason, in those UDP packets. This translates to 1316 / 188 = 7 TS packets
        // as a limit of what can be pushed through a single UDP packet. Here's the problem...you need to have
        // enough data to fill that pipe, all the time. Network latency, ffmpeg overhead, and the speed / quality of
        // the original camera stream all play a role here, and as you can imagine, there's a nearly endless set of
        // combinations to decide how to best fill that pipe. Set it too low, and you're incurring extra overhead by
        // pushing less video data to clients in each packet, though you're increasing interactivity by getting
        // whatever data you have to the end user. Set it too high, and startup latency becomes unacceptable
        // when you begin a stream.
        //
        // For audio, you have a latency problem and a packet size that's too big will force the audio to sound choppy
        // - so we opt to increase responsiveness at the risk of more overhead. This gives the end user a much better
        // audio experience, at a marginal cost in bandwidth overhead.
        //
        // Through experimentation, I've found a sweet spot of 188 * 3 = 564 for video on Protect cameras. In my testing,
        // adjusting the packet size beyond 564 did not have a material impact in improving the startup time, and often had
        // a negative impact.
        const videomtu: number = 188 * 3;
        const audiomtu: number = 188;

        // -rtsp_transport tcp: tell the RTSP stream handler that we're looking for a TCP connection.
        const streamingUrl: string = Unifi.generateStreamingUrlForBestMatchingResolution(this.cameraConfig.source, this.camera.streams, request.video.width, request.video.height);

        // -hide_banner                     Suppress printing the startup banner in FFmpeg.
        // -probesize 2048                  How many bytes should be analyzed for stream information. We default to to analyze time should be spent analyzing
        //                                  the input stream, in microseconds.
        // -max_delay 500000                Set an upper limit on how much time FFmpeg can take in demuxing packets.
        // -r fps                           Set the input frame rate for the video stream.
        // -rtsp_transport tcp              Tell the RTSP stream handler that we're looking for a TCP connection.
        // -i this.rtspEntry.url            RTSPS URL to get our input stream from.
        // -map 0:v:0                       selects the first available video track from the stream. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        //                                  Yes, we included these above as well: they need to be included for every I/O stream to maximize effectiveness it seems.
        const ffmpegArgs: string[] = [
            "-hide_banner",
            "-probesize", "16384",
            "-max_delay", "500000",
            "-r", request.video.fps.toString(),
            "-rtsp_transport", "tcp",
            "-i", streamingUrl,
            "-map", "0:v:0"
        ];

        this.log.info('%s: HomeKit video stream request received: %sx%s, %s fps, %s kbps.', this.camera.name, request.video.width, request.video.height, request.video.fps, request.video.max_bit_rate);
        this.log.info('%s: Selected stream: %s for playback', this.camera.name, streamingUrl);

        ffmpegArgs.push(
            "-vcodec", "copy"
        );

        // Configure our video parameters for transcoding:
        //
        // -vcodec libx264     Copy the stream without reencoding it.
        // -pix_fmt yuvj420p   Use the yuvj420p pixel format, which is what Protect uses.
        // -profile:v high     Use the H.264 high profile when encoding, which provides for better stream quality and size efficiency.
        // -preset veryfast    Use the veryfast encoding preset in libx264, which provides a good balance of encoding speed and quality.
        // -bf 0               Disable B-frames when encoding to increase compatibility against occasionally finicky HomeKit clients.
        // -b:v bitrate        The average bitrate to use for this stream. This is specified by HomeKit.
        // -bufsize size       This is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -maxrate bitrate    The maximum bitrate tolerance, used with -bufsize. We set this to max_bit_rate to effectively
        //                     create a constant bitrate.
        // -filter:v fps=fps=  Use the fps filter to get to the frame rate requested by HomeKit. This has better performance characteristics
        //                     for Protect rather than using "-r".
        // TODO: Add option to switch to transcoding!
        /*ffmpegArgs.push(
            "-vcodec", 'libx264',
            "-pix_fmt", "yuvj420p",
            "-profile:v", "high",
            "-preset", "veryfast",
            "-bf", "0",
            "-b:v", request.video.max_bit_rate.toString() + "k",
            "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
            "-maxrate", request.video.max_bit_rate.toString() + "k",
            "-filter:v", "fps=fps=" + request.video.fps.toString()
        );*/


        // Configure our video parameters for SRTP streaming:
        //
        // -payload_type num                Payload type for the RTP stream. This is negotiated by HomeKit and is usually 99 for H.264 video.
        // -ssrc                            Synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
        // -f rtp                           Specify that we're using the RTP protocol.
        // -srtp_out_suite enc              Specify the output encryption encoding suites.
        // -srtp_out_params params          Specify the output encoding parameters. This is negotiated by HomeKit.
        ffmpegArgs.push(
            "-payload_type", request.video.pt.toString(),
            "-ssrc", sessionInfo.videoSSRC.toString(),
            "-f", "rtp",
            "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
            "-srtp_out_params", sessionInfo.videoSRTP.toString("base64"),
            "srtp://" + sessionInfo.address + ":" + sessionInfo.videoPort.toString() + "?rtcpport=" + sessionInfo.videoPort.toString() +
            "&localrtcpport=" + sessionInfo.videoPort.toString() + "&pkt_size=" + videomtu.toString()
        );

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports libfdk_aac. Options we use are:
        //
        // -map 0:a:0                       Selects the first available audio track from the stream. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        // -acodec libfdk_aac               Encode to AAC.
        // -profile:a aac_eld               Specify enhanced, low-delay AAC for HomeKit.
        // -flags +global_header            Sets the global header in the bit stream.
        // -f null                          Null filter to pass the audio unchanged without running through a muxing operation.
        // -ar sample rate                  Sample rate to use for this audio. This is specified by HomeKit.
        // -b:a bitrate                     Bitrate to use for this audio. This is specified by HomeKit.
        // -bufsize size                    This is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -ac 1                            Set the number of audio channels to 1.
        if (sessionInfo.hasLibFdk) {

            // Configure our audio parameters.
            ffmpegArgs.push(
                "-map", "0:a:0",
                "-acodec", "libfdk_aac",
                "-profile:a", "aac_eld",
                "-flags", "+global_header",
                "-f", "null",
                "-ar", request.audio.sample_rate.toString() + "k",
                "-b:a", request.audio.max_bit_rate.toString() + "k",
                "-bufsize", (2 * request.audio.max_bit_rate).toString() + "k",
                "-ac", "1"
            );

            // Add the required RTP settings and encryption for the stream:
            //
            // -payload_type num                Payload type for the RTP stream. This is negotiated by HomeKit and is usually 110 for AAC-ELD audio.
            // -ssrc                            synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
            // -f rtp                           Specify that we're using the RTP protocol.
            // -srtp_out_suite enc              Specify the output encryption encoding suites.
            // -srtp_out_params params          Specify the output encoding parameters. This is negotiated by HomeKit.
            ffmpegArgs.push(
                "-payload_type", request.audio.pt.toString(),
                "-ssrc", sessionInfo.audioSSRC.toString(),
                "-f", "rtp",
                "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
                "-srtp_out_params", sessionInfo.audioSRTP.toString("base64"),
                "srtp://" + sessionInfo.address + ":" + sessionInfo.audioPort.toString() + "?rtcpport=" + sessionInfo.audioPort.toString() +
                "&localrtcpport=" + sessionInfo.audioPort.toString() + "&pkt_size=" + audiomtu.toString()
            );
        }

        // Combine everything and start an instance of FFmpeg.
        const ffmpegStream = new FfmpegProcess(this, request.sessionID, ffmpegArgs,
            (sessionInfo.hasLibFdk && this.camera.supportsTwoWayAudio) ? undefined : { addressVersion: sessionInfo.addressVersion, port: sessionInfo.videoReturnPort },
            callback);

        // Some housekeeping for our FFmpeg and demuxer sessions.
        this.ongoingSessions[request.sessionID] = { ffmpeg: [ffmpegStream], rtpDemuxer: sessionInfo.rtpDemuxer };
        delete this.pendingSessions[request.sessionID];

        // If we aren't doing two-way audio, we're done here. For two-way audio...we have some more plumbing to do.
        if (!sessionInfo.hasLibFdk || !this.camera.supportsTwoWayAudio) {
            return;
        }

        // Session description protocol message that FFmpeg will share with HomeKit.
        // SDP messages tell the other side of the connection what we're expecting to receive.
        //
        // Parameters are:
        //
        // v             Protocol version - always 0.
        // o             Originator and session identifier.
        // s             Session description.
        // c             Connection information.
        // t             Timestamps for the start and end of the session.
        // m             Media type - audio, adhering to RTP/AVP, payload type 110.
        // b             Bandwidth information - application specific, 24k.
        // a=rtpmap      Payload type 110 corresponds to an MP4 stream.
        // a=fmtp        For payload type 110, use these format parameters.
        // a=crypto      Crypto suite to use for this session.
        const sdpReturnAudio = [
            "v=0",
            "o=- 0 0 IN " + sdpIpVersion + " 127.0.0.1",
            "s=" + this.camera.name + " Audio Talkback",
            "c=IN " + sdpIpVersion + " " + sessionInfo.address,
            "t=0 0",
            "m=audio " + sessionInfo.audioIncomingRtpPort.toString() + " RTP/AVP 110",
            "b=AS:24",
            "a=rtpmap:110 MPEG4-GENERIC/16000/1",
            "a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=F8F0212C00BC00",
            "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:" + sessionInfo.audioSRTP.toString("base64")
        ].join("\n");

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports libfdk_aac. Options we use are:
        //
        // -hide_banner           Suppress printing the startup banner in FFmpeg.
        // -protocol_whitelist    Set the list of allowed protocols for this FFmpeg session.
        // -f sdp                 Specify that our input will be an SDP file.
        // -acodec libfdk_aac     Decode AAC input.
        // -i pipe:0              Read input from standard input.
        // -acodec aac            Encode to AAC. This is set by Protect.
        // -flags +global_header  Sets the global header in the bitstream.
        // -ar samplerate         Sample rate to use for this audio. This is specified by Protect.
        // -b:a bitrate           Bitrate to use for this audio. This is specified by Protect.
        // -ac 1                  Set the number of audio channels to 1. This is specified by Protect.
        // -f adts                Transmit an ADTS stream.
        // pipe:1                 Output the ADTS stream to standard output.
        const ffmpegReturnAudioCmd = [
            "-hide_banner",
            "-protocol_whitelist", "crypto,file,pipe,rtp,udp",
            "-f", "sdp",
            "-acodec", "libfdk_aac",
            "-i", "pipe:0",
            "-flags", "+global_header",
            "-b:a", this.camera.talkbackSettings.bitsPerSample.toString() + "k",
            "-ac", this.camera.talkbackSettings.channels.toString(),
            "-ar", this.camera.talkbackSettings.samplingRate.toString(),
            "-loglevel", "level+verbose",
            "-f", "adts",
            "pipe:1"
        ];

        const ffmpegReturnAudio = new FfmpegProcess(this, request.sessionID, ffmpegReturnAudioCmd);

        // Housekeeping for the twoway FFmpeg session.
        this.ongoingSessions[request.sessionID].ffmpeg.push(ffmpegReturnAudio);

        // Feed the SDP session description to ffmpeg on stdin.
        ffmpegReturnAudio.getStdin()?.write(sdpReturnAudio);
        ffmpegReturnAudio.getStdin()?.end();
    }

    // Prepare to launch the video stream.
    public async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

        // We need to check for AAC support because it's going to determine whether we support audio.
        const hasLibFdk = await FfmpegProcess.codecEnabled(this.videoProcessor, 'libfdk_aac');

        // Setup our audio plumbing.
        const audioIncomingRtcpPort = (await RtpUtils.reservePorts())[0];
        const audioIncomingPort = (hasLibFdk && this.camera.supportsTwoWayAudio) ? (await RtpUtils.reservePorts())[0] : -1;
        const audioIncomingRtpPort = (hasLibFdk && this.camera.supportsTwoWayAudio) ? (await RtpUtils.reservePorts(2))[0] : -1;
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

        if (!hasLibFdk) {
            this.log.info('%s: Audio support disabled. A version of FFmpeg that is compiled with fdk_aac support is required to support audio.', this.camera.name);
        }

        // Setup the RTP demuxer for two-way audio scenarios.
        const rtpDemuxer = (hasLibFdk && this.camera.supportsTwoWayAudio) ?
            new RtpDemuxer(this, request.addressVersion, audioIncomingPort, audioIncomingRtcpPort, audioIncomingRtpPort) : null;

        // Setup our video plumbing.
        const videoReturnPort = (await RtpUtils.reservePorts())[0];
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

        const sessionInfo: SessionInfo = {
            address: request.targetAddress,
            addressVersion: request.addressVersion,

            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioIncomingRtcpPort: audioIncomingRtcpPort,
            audioIncomingRtpPort: audioIncomingRtpPort,
            audioPort: request.audio.port,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: audioSSRC,

            hasLibFdk: hasLibFdk,
            rtpDemuxer: rtpDemuxer,

            videoCryptoSuite: request.video.srtpCryptoSuite,
            videoPort: request.video.port,
            videoReturnPort: videoReturnPort,
            videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            videoSSRC: videoSSRC
        };

        // Prepare the response stream. Here's where we figure out if we're doing two-way audio or not. For two-way audio,
        // we need to use a demuxer to separate RTP and RTCP packets. For traditional video/audio streaming, we want to keep
        // it simple and don't use a demuxer.
        const response: PrepareStreamResponse = {
            audio: {
                port: (hasLibFdk && this.camera.supportsTwoWayAudio) ? audioIncomingPort : audioIncomingRtcpPort,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt,
                ssrc: audioSSRC
            },

            video: {
                port: videoReturnPort,
                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt,
                ssrc: videoSSRC
            }
        };

        // Add it to the pending session queue so we're ready to start when we're called upon.
        this.pendingSessions[request.sessionID] = sessionInfo;
        callback(undefined, response);
    }

    // Close a video stream.
    public stopStream(sessionId: string): void {

        try {

            // Stop any FFmpeg instances we have running.
            if (this.ongoingSessions[sessionId]) {
                for (const ffmpegProcess of this.ongoingSessions[sessionId].ffmpeg) {
                    ffmpegProcess.stop();
                }
            }

            // Close the demuxer, if we have one.
            this.ongoingSessions[sessionId]?.rtpDemuxer?.close();

            // Delete the entries.
            delete this.pendingSessions[sessionId];
            delete this.ongoingSessions[sessionId];

            // Inform the user.
            this.log.info('%s: Stopped video streaming session.', this.camera.name);

        } catch (error) {

            this.log.error('%s: Error occurred while ending the FFmpeg video processes: %s.', this.camera.name, error);
        }
    }

    // Shutdown all our video streams.
    public shutdown(): void {
        for (const session of Object.keys(this.ongoingSessions)) {
            this.stopStream(session);
        }
    }
}
