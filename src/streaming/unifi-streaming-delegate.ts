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
import {ImageUtils} from '../utils/image-utils';
import {Canvas} from 'canvas';
import {UnifiCamera} from '../unifi/unifi';
import {UnifiFlows} from '../unifi/unifi-flows';
import {FfmpegProcess} from './ffmpeg-process';
import {RtpSplitter, RtpUtils} from './rtp-splitter';
import {CameraConfig} from './camera-config';
import ffmpegPath from "ffmpeg-for-homebridge";

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
    audioReturnPort: number;
    audioTwoWayPort: number; // Port to receive audio from the HomeKit microphone.
    rtpSplitter: RtpSplitter | null; // RTP splitter needed for two-way audio.
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

    private readonly ongoingSessions: { [index: string]: { ffmpeg: FfmpegProcess[], rtpSplitter: RtpSplitter | null } };
    private readonly pendingSessions: { [index: string]: SessionInfo };

    public controller: CameraController;

    constructor(camera: UnifiCamera, log: Logging, api: API, cameraConfig: CameraConfig, videoProcessor: string) {
        this.camera = camera;
        this.cameraName = camera.name;

        this.api = api;
        this.hap = api.hap;
        this.log = log;
        this.ongoingSessions = {};
        this.pendingSessions = {};
        this.videoProcessor = videoProcessor || ffmpegPath || "ffmpeg";

        this.cameraConfig = cameraConfig;

        const options: CameraControllerOptions = {
            cameraStreamCount: 2, // HomeKit requires at least 2 streams, and HomeKit Secure Video requires 1.
            delegate: this,
            streamingOptions: {
                supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
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
                    ],
                    codec: {
                        profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
                        levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0]
                    }
                },
                audio: {
                    codecs: [
                        {
                            type: AudioStreamingCodecType.AAC_ELD,
                            samplerate: AudioStreamingSamplerate.KHZ_16
                        }
                    ],
                    twoWayAudio: this.camera.supportsTwoWayAudio
                }
            }
        };
        this.controller = new this.hap.CameraController(options);
    }

    //This is called by Homekit!
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

    public async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

        // We need to check for AAC support because it's going to inform our audio support.
        const hasLibFdk = await FfmpegProcess.codecEnabled(this.videoProcessor, 'libfdk_aac');

        // Setup our audio plumbing.
        const audioReturnPort = (await RtpUtils.reservePorts())[0];
        const audioServerPort = (hasLibFdk && this.camera.supportsTwoWayAudio) ? (await RtpUtils.reservePorts())[0] : -1;
        const audioTwoWayPort = (hasLibFdk && this.camera.supportsTwoWayAudio) ? (await RtpUtils.reservePorts(2))[0] : -1;
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

        if (!hasLibFdk) {
            this.log.info('%s: Audio support disabled. A version of FFmpeg that is compiled with fdk_aac support is required to support audio.', this.camera.name);
        }

        // Setup the RTP splitter for two-way audio scenarios.
        const rtpSplitter = (hasLibFdk && this.camera.supportsTwoWayAudio) ?
            new RtpSplitter(this, request.addressVersion, audioServerPort, audioReturnPort, audioTwoWayPort) : null;

        // Setup our video plumbing.
        const videoReturnPort = (await RtpUtils.reservePorts())[0];
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

        const sessionInfo: SessionInfo = {
            address: request.targetAddress,
            addressVersion: request.addressVersion,

            videoPort: request.video.port,
            videoReturnPort: videoReturnPort,
            videoCryptoSuite: request.video.srtpCryptoSuite,
            videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            videoSSRC: videoSSRC,

            hasLibFdk: hasLibFdk,
            audioPort: request.audio.port,
            audioTwoWayPort: audioTwoWayPort,
            rtpSplitter: rtpSplitter,
            audioReturnPort: audioReturnPort,
            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: audioSSRC
        };

        // Prepare the response stream.
        const response: PrepareStreamResponse = {

            video: {
                port: videoReturnPort,
                ssrc: videoSSRC,

                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt
            },

            audio: {
                port: (hasLibFdk && this.camera.supportsTwoWayAudio) ? audioServerPort : audioReturnPort,
                ssrc: audioSSRC,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt
            }
        };

        // Figure out if we have the ability to deal with audio. If we do, we next have to figure out
        // if we're doing two-way audio or not. For two-way audio, we need to use a splitter to bring all
        // the pieces together. For traditional video/audio streaming, we want to keep it simple and don't
        // use a splitter.

        // Add it to the pending session queue so we're ready to start when we're called upon.
        this.pendingSessions[request.sessionID] = sessionInfo;
        callback(undefined, response);
    }

    // Launch the Protect video (and audio) stream.
    private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {

        const sessionInfo = this.pendingSessions[request.sessionID];

        // Set our packet size to be 564. Why? MPEG transport stream (TS) packets are 188 bytes in size each.
        // These packets transmit the video data that you ultimately see on your screen and are transmitted using
        // UDP. Each UDP packet is 1316 bytes in size, before being encapsulated in IP. We want to get as many
        // TS packets as we can, within reason, in those UDP packets. This translates to 1316 / 188 = 7 TS packets
        // as a limit of what can be pushed through over a network connection. Here's the problem...you need to have
        // enough data to fill that pipe, all the time. Network latency, ffmpeg overhead, and the speed / quality of
        // the original camera stream all play a role here, and as you can imagine, there's a nearly endless set of
        // combinations to deciding how to fill that pipe. Set it too low, and you're incurring extra overhead in
        // pushing less data to clients, though you're increasing interactivity by getting whatever data you have to
        // the end user. Set it too high, and startup latency becomes unacceptable when you're trying to stream.
        //
        // For audio, you have a latency problem and a packet size that's too big will force the audio to sound choppy
        // - so we opt to increase responsiveness at the risk of more overhead. This gives the end user a much better
        // audio experience, at a very marginal cost in bandwidth overhead.
        //
        // Through experimentation, I've found a sweet spot of 188 * 3 = 564 for video on Protect cameras. This works
        // very well for G3-series cameras, and pretty well for G4-series cameras. The G4s tend to push a lot more data
        // which drives the latency higher when you're first starting up a stream. In my testing, adjusting the packet
        // size beyond 564 did not have a material impact in improving the startup time of a G4 camera, but did have
        // a negative impact on G3 cameras.
        const videomtu: number = 188 * 3;
        const audiomtu: number = 188;

        // -rtsp_transport tcp: tell the RTSP stream handler that we're looking for a TCP connection.
        const fcmd: string[] = ['-hide_banner', '-rtsp_transport', 'tcp', '-i', this.cameraConfig.source];

        this.log.info('%s: HomeKit video stream request received: %sx%s, %s fps, %s kbps.', this.camera.name, request.video.width, request.video.height, request.video.fps, request.video.max_bit_rate);

        // Configure our video parameters:
        // -map 0:v           selects the first available video track from the stream. Protect actually maps audio
        //                    and video tracks in opposite locations from where ffmpeg typically expects them. This
        //                    setting is a more general solution than naming the track locations directly in case
        //                    Protect changes this in n the future.
        // -vcodec copy       copy the stream withour reencoding it.
        // -f rawvideo        specify that we're using raw video.
        // -pix_fmt yuvj420p  use the yuvj420p pixel format, which is what Protect uses.
        // -r fps             frame rate to use for this stream. This is specified by HomeKit.
        // -b:v bitrate       the average bitrate to use for this stream. This is specified by HomeKit.
        // -bufsize size      this is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -maxrate bitrate   the maximum bitrate tolerance, used with -bufsize. We set this to max_bit_rate to effectively
        //                    create a constant bitrate.
        // -payload_type num  payload type for the RTP stream. This is negotiated by HomeKit and is usually 99 for H.264 video.
        const ffmpegVideoArgs: string[] = [
            '-map', '0:v',
            '-vcodec', 'copy',
            '-f', 'rawvideo',
            '-pix_fmt', 'yuvj420p',
            '-r', request.video.fps.toString(),
            //...this.platform.cameraConfig.ffmpegOptions.split(' '), // TODO: Is this still needed?
            '-b:v', request.video.max_bit_rate.toString() + 'k',
            '-bufsize', (2 * request.video.max_bit_rate).toString() + 'k',
            '-maxrate', request.video.max_bit_rate.toString() + 'k',
            '-payload_type', request.video.pt.toString()
        ];

        // Add the required RTP settings and encryption for the stream:
        // -ssrc                   synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
        // -f rtp                  specify that we're using the RTP protocol.
        // -srtp_out_suite enc     specify the output encryption encoding suites.
        // -srtp_out_params params specify the output encoding parameters. This is negotiated by HomeKit.
        const ffmpegVideoStream: string[] = [
            '-ssrc', sessionInfo.videoSSRC.toString(),
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
            'srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort.toString() + '?rtcpport=' + sessionInfo.videoPort.toString() +
            '&localrtcpport=' + sessionInfo.videoPort.toString() + '&pkt_size=' + videomtu.toString()
        ];

        // Assemble the final video command line.
        fcmd.push(...ffmpegVideoArgs, ...ffmpegVideoStream);

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports libfdk_aac. Options we use are:
        //
        // -map 0:a              selects the first available audio track from the stream. Protect actually maps audio
        //                       and video tracks in opposite locations from where ffmpeg typically expects them. This
        //                       setting is a more general solution than naming the track locations directly in case
        //                       Protect changes this in the future.
        // -acodec libfdk_aac    encode to AAC.
        // -profile:a aac_eld    specify enhanced, low-delay AAC for HomeKit.
        // -flags +global_header sets the global header in the bitstream.
        // -f null               null filter to pass the audio unchanged without running through a muxing operation.
        // -ar samplerate        sample rate to use for this audio. This is specified by HomeKit.
        // -b:a bitrate          bitrate to use for this audio. This is specified by HomeKit.
        // -bufsize size         this is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -ac 1                 set the number of audio channels to 1.
        if (sessionInfo.hasLibFdk) {

            // Configure our video parameters.
            const ffmpegAudioArgs = [
                '-map', '0:a',
                '-acodec', 'libfdk_aac',
                '-profile:a', 'aac_eld',
                '-flags', '+global_header',
                '-f', 'null',
                '-ar', request.audio.sample_rate.toString() + 'k',
                '-b:a', request.audio.max_bit_rate.toString() + 'k',
                '-bufsize', (2 * request.audio.max_bit_rate).toString() + 'k',
                '-ac', '1'
            ];

            // Add the required RTP settings and encryption for the stream:
            // -ssrc                   synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
            // -f rtp                  specify that we're using the RTP protocol.
            // -srtp_out_suite enc     specify the output encryption encoding suites.
            // -srtp_out_params params specify the output encoding parameters. This is negotiated by HomeKit.
            // -payload_type num     payload type for the RTP stream. This is negotiated by HomeKit and is usually 110 for AAC-ELD audio.
            const ffmpegAudioStream = [
                '-payload_type', request.audio.pt.toString(),
                '-ssrc', sessionInfo.audioSSRC.toString(),
                '-f', 'rtp',
                '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                '-srtp_out_params', sessionInfo.audioSRTP.toString('base64'),
                'srtp://' + sessionInfo.address + ':' + sessionInfo.audioPort.toString() + '?rtcpport=' + sessionInfo.audioPort.toString() +
                '&localrtcpport=' + sessionInfo.audioPort.toString() + '&pkt_size=' + audiomtu.toString()
            ];

            fcmd.push(...ffmpegAudioArgs, ...ffmpegAudioStream);
        }

        // Combine everything and start an instance of FFmpeg.
        const ffmpeg = new FfmpegProcess(this, request.sessionID, fcmd,
            (sessionInfo.hasLibFdk && this.camera.supportsTwoWayAudio) ? undefined : {
                addressVersion: sessionInfo.addressVersion,
                port: sessionInfo.videoReturnPort
            },
            callback);

        // Some housekeeping for our FFmpeg and splitter sessions.
        this.ongoingSessions[request.sessionID] = {ffmpeg: [ffmpeg], rtpSplitter: sessionInfo.rtpSplitter};
        delete this.pendingSessions[request.sessionID];

        // If we aren't doing two-way audio, we're done here. For two-way audio...we have some more plumbing to do.
        if (!sessionInfo.hasLibFdk || !this.camera.supportsTwoWayAudio) {
            return;
        }

        //const camera = this.protectCamera.accessory.context.camera as ProtectCameraConfig;
        const sdpIpVersion = sessionInfo.addressVersion === 'ipv6' ? 'IP6 ' : 'IP4';

        // Session description protocol message that FFmpeg will share with HomeKit.
        // SDP messages tell the other side of the connection what we're expecting to receive.
        //
        // Parameters are:
        // v             protocol version - always 0.
        // o             originator and session identifier.
        // s             session description.
        // c             connection information.
        // t             timestamps for the start and end of the session.
        // m             media type - audio, adhering to RTP/AVP, payload type 110.
        // b             bandwidth information - application specific, 24k.
        // a=rtpmap      payload type 110 corresponds to an MP4 stream.
        // a=fmtp        for payload type 110, use these format parameters.
        // a=crypto      crypto suite to use for this session.
        const sdpReturnAudio = [
            'v=0',
            'o=- 0 0 IN ' + sdpIpVersion + ' 127.0.0.1',
            's=' + this.camera.name + ' Audio Talkback',
            'c=IN ' + sdpIpVersion + ' ' + sessionInfo.address,
            't=0 0',
            'm=audio ' + sessionInfo.audioTwoWayPort.toString() + ' RTP/AVP 110',
            'b=AS:24',
            'a=rtpmap:110 MPEG4-GENERIC/16000/1',
            'a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; cameraConfig=F8F0212C00BC00',
            'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + sessionInfo.audioSRTP.toString('base64')
        ].join('\n');

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports libfdk_aac. Options we use are:
        //
        // -protocol_whitelist   set the list of allowed protocols for this ffmpeg session.
        // -f sdp                specify that our input will be an SDP file.
        // -acodec libfdk_aac    decode AAC input.
        // -i pipe:0             read input from standard input.
        // -map 0:a              selects the first available audio track from the stream.
        // -acodec aac           encode to AAC. This is set by Protect.
        // -flags +global_header sets the global header in the bitstream.
        // -ar samplerate        sample rate to use for this audio. This is specified by Protect.
        // -b:a bitrate          bitrate to use for this audio. This is specified by Protect.
        // -ac 1                 set the number of audio channels to 1. This is specified by Protect.
        // -f adts               transmit an ADTS stream.
        const ffmpegReturnAudioCmd = [
            '-hide_banner',
            '-protocol_whitelist', 'pipe,udp,rtp,file,crypto',
            '-f', 'sdp',
            '-acodec', 'libfdk_aac',
            '-i', 'pipe:0',
            '-map', '0:a',
            '-acodec', '',//camera.talkbackSettings.typeFmt, //TODO: Fix this for two way audio!
            '-flags', '+global_header',
            '-ar', '',//camera.talkbackSettings.samplingRate.toString(), //TODO: Fix this for two way audio!
            '-b:a', '64k',
            '-ac', '',//camera.talkbackSettings.channels.toString(), //TODO: Fix this for two way audio!
            '-f', 'adts',
            ''// 'udp://' + camera.host + ':' + camera.talkbackSettings.bindPort.toString() //TODO: Fix this for two way audio!
        ];

        const ffmpegReturnAudio = new FfmpegProcess(this, request.sessionID, ffmpegReturnAudioCmd);
        this.ongoingSessions[request.sessionID].ffmpeg.push(ffmpegReturnAudio);
        ffmpegReturnAudio.getStdin()?.write(sdpReturnAudio);
        ffmpegReturnAudio.getStdin()?.end();
    }

    public stopStream(sessionId: string): void {
        try {
            if (this.ongoingSessions[sessionId]) {
                for (const ffmpegProcess of this.ongoingSessions[sessionId].ffmpeg) {
                    ffmpegProcess.stop();
                }
            }
            this.ongoingSessions[sessionId]?.rtpSplitter?.close();

            delete this.pendingSessions[sessionId];
            delete this.ongoingSessions[sessionId];

            this.log.info('%s: Stopped video streaming session.', this.camera.name);
        } catch (error) {
            this.log.error('%s: Error occurred while ending the FFmpeg video processes: %s.', this.camera.name, error);
        }
    }
}