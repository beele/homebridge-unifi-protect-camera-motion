/* Copyright(C) 2017-2024, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * protect-stream.ts: Homebridge camera streaming delegate implementation for Protect.
 *
 * This module is heavily inspired by the homebridge and homebridge-camera-ffmpeg source code. Thank you for your contributions to the HomeKit world.
 */
import {
    API, AudioRecordingCodecType, AudioRecordingSamplerate, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController,
    CameraControllerOptions, CameraStreamingDelegate, H264Level, H264Profile, HAP, Logging, MediaContainerType, PlatformAccessory, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse,
    SRTPCryptoSuites, Service, SnapshotRequest, SnapshotRequestCallback, StartStreamRequest, StreamRequestCallback, StreamRequestTypes,
    StreamingRequest
} from "homebridge";
import { Nullable, RtpDemuxer } from "homebridge-plugin-utils";
import { once } from "node:events";
import WebSocket from "ws";
import {
    PROTECT_FFMPEG_AUDIO_FILTER_FFTNR, PROTECT_HKSV_FRAGMENT_LENGTH, PROTECT_HKSV_TIMESHIFT_BUFFER_MAXDURATION, PROTECT_HOMEKIT_IDR_INTERVAL,
    PROTECT_LIVESTREAM_API_IDR_INTERVAL,
    PROTECT_TRANSCODE_BITRATE,
    PROTECT_TRANSCODE_HIGH_LATENCY_BITRATE
} from "../settings.js";
import { Unifi, UnifiCamera, UnifiCameraStream } from "../unifi/unifi.js";
import { FakePlatform } from "./ffmpeg/protect-ffmpeg.js";
import { FfmpegStreamingProcess } from "./ffmpeg/protect-ffmpeg-stream.js";
import { FfmpegOptions } from "./ffmpeg/protect-ffmpeg-options.js";
import { ImageUtils } from "../utils/image-utils.js";
import { Canvas, loadImage } from "canvas";
import { ProtectRecordingDelegate } from "./recording-delegate.js";

type OngoingSessionEntry = {
    ffmpeg: FfmpegStreamingProcess[],
    rtpDemuxer: Nullable<RtpDemuxer>,
    rtpPortReservations: number[],
    toggleLight?: Service
};

type SessionInfo = {
    address: string; // Address of the HomeKit client.
    addressVersion: string;

    audioCryptoSuite: SRTPCryptoSuites;
    audioIncomingRtcpPort: number;
    audioIncomingRtpPort: number; // Port to receive audio from the HomeKit microphone.
    audioPort: number;
    audioSRTP: Buffer;
    audioSSRC: number;

    hasAudioSupport: boolean; // Does the user have a version of FFmpeg that supports AAC-ELD?

    rtpDemuxer: Nullable<RtpDemuxer>; // RTP demuxer needed for two-way audio.
    rtpPortReservations: number[]; // RTP port reservations.

    talkBack: Nullable<string>; // Talkback websocket needed for two-way audio.

    videoCryptoSuite: SRTPCryptoSuites; // This should be saved if multiple suites are supported.
    videoPort: number;
    videoReturnPort: number;
    videoSRTP: Buffer; // Key and salt concatenated.
    videoSSRC: number; // RTP synchronisation source.
};

// Camera streaming delegate implementation for Protect.
export class ProtectStreamingDelegate implements CameraStreamingDelegate {

    public static unifi: Unifi | undefined;

    private readonly api: API;
    private readonly hap: HAP;
    public readonly log: Logging;

    public readonly ffmpegOptions: FfmpegOptions;

    public readonly platform: FakePlatform;
    public readonly camera: UnifiCamera;

    public verboseFfmpeg: boolean;

    private ongoingSessions: { [index: string]: OngoingSessionEntry };
    private pendingSessions: { [index: string]: SessionInfo };

    private probesizeOverride: number;
    private probesizeOverrideCount: number;
    private probesizeOverrideTimeout?: NodeJS.Timeout;

    //public hksv: Nullable<ProtectRecordingDelegate>;

    public controller: CameraController;

    // Create an instance of a HomeKit streaming delegate.
    constructor(platform: FakePlatform, protectCamera: UnifiCamera, accessory: PlatformAccessory, resolutions: [number, number, number][], logging: Logging) {

        this.api = platform.api;
        this.hap = platform.hap;
        this.log = logging;

        // Configure our hardware acceleration support.
        this.ffmpegOptions = new FfmpegOptions(platform, protectCamera, logging);

        this.platform = platform;
        this.camera = protectCamera;  

        this.verboseFfmpeg = false;

        this.ongoingSessions = {};
        this.pendingSessions = {}; 
        
        this.probesizeOverride = 0;
        this.probesizeOverrideCount = 0;

        //this.hksv = null;
        // Setup for HKSV, if enabled.
        if (this.platform.config.hksv) {
            //this.hksv = new ProtectRecordingDelegate(platform, protectCamera, accessory, this.ffmpegOptions, logging);
        }

        // Setup for our camera controller.
        const options: CameraControllerOptions = {
            // HomeKit requires at least 2 streams, and HomeKit Secure Video requires 1.
            cameraStreamCount: 10,

            // Our streaming delegate - aka us.
            delegate: this,

            // Our recording capabilities for HomeKit Secure Video.
            /*recording: !this.platform.config.hksv ? undefined : {
                delegate: this.hksv as ProtectRecordingDelegate,
                options: {
                    audio: {
                        codecs: [
                            {
                                // Protect supports a 48 KHz sampling rate, and the low complexity AAC profile.
                                samplerate: AudioRecordingSamplerate.KHZ_48,
                                type: AudioRecordingCodecType.AAC_LC
                            }
                        ]
                    },
                    mediaContainerConfiguration: [
                        {
                            // The default HKSV segment length is 4000ms. It turns out that any setting less than that will disable HomeKit Secure Video.
                            fragmentLength: PROTECT_HKSV_FRAGMENT_LENGTH,
                            type: MediaContainerType.FRAGMENTED_MP4
                        }
                    ],
                    // Maximum prebuffer length supported. In Protect, this is effectively unlimited, but HomeKit only seems to request a maximum of a 4000ms prebuffer.
                    prebufferLength: PROTECT_HKSV_TIMESHIFT_BUFFER_MAXDURATION,
                    video: {
                        parameters: {
                            // Through admittedly anecdotal testing on various G3 and G4 models, UniFi Protect seems to support only the H.264 Main profile, though it does support
                            // various H.264 levels, ranging from Level 3 through Level 5.1 (G4 Pro at maximum resolution). However, HomeKit only supports Level 3.1, 3.2, and 4.0
                            // currently.
                            levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                            profiles: [H264Profile.MAIN]
                        },
                        resolutions: resolutions,
                        type: this.api.hap.VideoCodecType.H264
                    }
                }
            }, */

            streamingOptions: {
                audio: {
                    codecs: [
                        {
                            audioChannels: 1,
                            bitrate: 0,
                            samplerate: [AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24],
                            type: AudioStreamingCodecType.AAC_ELD
                        }
                    ],
                    twoWayAudio: this.camera.supportsTwoWayAudio
                },
                supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
                    codec: {
                        // Through admittedly anecdotal testing on various G3 and G4 models, UniFi Protect seems to support only the H.264 Main profile, though it does support
                        // various H.264 levels, ranging from Level 3 through Level 5.1 (G4 Pro at maximum resolution). However, HomeKit only supports Level 3.1, 3.2, and 4.0
                        // currently.
                        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                        profiles: [H264Profile.MAIN]
                    },
                    // Retrieve the list of supported resolutions from the camera and apply our best guesses for how to map specific resolutions to the available RTSP streams on a
                    // camera. Unfortunately, this creates challenges in doing on-the-fly RTSP changes in UniFi Protect. Once the list of supported resolutions is set here, there's
                    // no going back unless a user retarts HBUP. Homebridge doesn't have a way to dynamically adjust the list of supported resolutions at this time.
                    resolutions: resolutions
                }
            }
        };

        this.controller = new this.hap.CameraController(options);
    }

    // HomeKit image snapshot request handler.
    public async handleSnapshotRequest(request?: SnapshotRequest, callback?: SnapshotRequestCallback): Promise<void> {
        if (!ProtectStreamingDelegate.unifi) {
            this.log.warn('Cannot get snapshot, Unifi logic not ready yet!');
            return;
        }
        
        if (!callback) {
            this.log.warn('Snapshot request received without callback!');
            return;
        }
        
        if (!request?.width || !request.height) {
            this.log.warn('Snapshot request received without width or height!');
            callback(new Error(this.camera.name + ": Snapshot request received without width or height!"));
            return;
        }     
            
        if (!this.camera.lastDetectionSnapshot) {
            this.log.debug('Getting new snapshot');

            try {
                const snapshotData = await ProtectStreamingDelegate.unifi.getSnapshotForCamera(this.camera, request?.width, request?.height)
                callback(undefined, snapshotData);
            } catch (error) {
                callback(new Error(this.camera.name + ": Unable to retrieve a snapshot"));
            }
        } else {
            this.log.debug('Returning annotated snapshot');
            const canvas: Canvas = ImageUtils.resizeCanvas(ImageUtils.createCanvasFromImage(await loadImage(this.camera.lastDetectionSnapshot)), request.width, request.height);
            callback(undefined, canvas.toBuffer('image/jpeg'));
        }
    }

    // Prepare to launch the video stream.
    public async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
        let reservePortFailed = false;
        const rtpPortReservations: number[] = [];

        // We use this utility to identify errors in reserving UDP ports for our use.
        const reservePort = async (ipFamily: ("ipv4" | "ipv6") = "ipv4", portCount: (1 | 2) = 1): Promise<number> => {
            // If we've already failed, don't keep trying to find more ports.
            if (reservePortFailed) {
                return -1;
            }

            // Retrieve the ports we're looking for.
            const assignedPort = await this.platform.rtpPorts.reserve(ipFamily, portCount);

            // We didn't get the ports we requested.
            if (assignedPort === -1) {
                reservePortFailed = true;
            } else {
                // Add this reservation the list of ports we've successfully requested.
                rtpPortReservations.push(assignedPort);
                if (portCount === 2) {
                    rtpPortReservations.push(assignedPort + 1);
                }
            }

            // Return them.
            return assignedPort;
        };

        // Check if the camera has a microphone and if we have audio support is enabled in the plugin.
        const isAudioEnabled = this.camera.supportsTwoWayAudio;

        // We need to check for AAC support because it's going to determine whether we support audio.
        const hasAudioSupport = isAudioEnabled && (this.ffmpegOptions.audioEncoder.length > 0);

        // Setup our audio plumbing.
        const audioIncomingRtcpPort = (await reservePort(request.addressVersion));
        const audioIncomingPort = (hasAudioSupport && isAudioEnabled) ? (await reservePort(request.addressVersion)) : -1;
        const audioIncomingRtpPort = (hasAudioSupport && isAudioEnabled) ? (await reservePort(request.addressVersion, 2)) : -1;

        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

        if (!hasAudioSupport) {
            this.log.info("Audio support disabled.%s", isAudioEnabled ? " A version of FFmpeg that is compiled with fdk_aac support is required to support audio." : "");
        }

        let rtpDemuxer = null;
        let talkBack: Nullable<string> = null;

        if (hasAudioSupport && isAudioEnabled) {
            // Setup the RTP demuxer for two-way audio scenarios.
            rtpDemuxer = new RtpDemuxer(request.addressVersion, audioIncomingPort, audioIncomingRtcpPort, audioIncomingRtpPort, this.log);

            // Request the talkback websocket from the controller.
            const params = new URLSearchParams({ camera: this.camera.id });

            talkBack = (await ProtectStreamingDelegate.unifi?.getWsEndpoint("talkback", params)) ?? null;

            // Something went wrong and we don't have a talkback websocket.
            if (!talkBack) {
                this.log.error("Unable to open the return audio channel.");
            }
        }

        // Setup our video plumbing.
        const videoReturnPort = (await reservePort(request.addressVersion));
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

        // If we've had failures to retrieve the UDP ports we're looking for, inform the user.
        if (reservePortFailed) {
            this.log.error("Unable to reserve the UDP ports needed to begin streaming.");
        }

        const sessionInfo: SessionInfo = {

            address: request.targetAddress,
            addressVersion: request.addressVersion,

            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioIncomingRtcpPort: audioIncomingRtcpPort,
            audioIncomingRtpPort: audioIncomingRtpPort,
            audioPort: request.audio.port,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: audioSSRC,

            hasAudioSupport: hasAudioSupport,
            rtpDemuxer: rtpDemuxer,
            rtpPortReservations: rtpPortReservations,
            talkBack: talkBack,

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
                port: (hasAudioSupport && isAudioEnabled) ? audioIncomingPort : audioIncomingRtcpPort,
                // eslint-disable-next-line camelcase
                srtp_key: request.audio.srtp_key,
                // eslint-disable-next-line camelcase
                srtp_salt: request.audio.srtp_salt,
                ssrc: audioSSRC
            },
            video: {
                port: videoReturnPort,
                // eslint-disable-next-line camelcase
                srtp_key: request.video.srtp_key,
                // eslint-disable-next-line camelcase
                srtp_salt: request.video.srtp_salt,
                ssrc: videoSSRC
            }
        };

        // Add it to the pending session queue so we're ready to start when we're called upon.
        this.pendingSessions[request.sessionID] = sessionInfo;
        callback(undefined, response);
    }

    // Launch the Protect video (and audio) stream.
    private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

        const sessionInfo = this.pendingSessions[request.sessionID];
        const sdpIpVersion = sessionInfo.addressVersion === "ipv6" ? "IP6" : "IP4";

        // If we aren't connected, we're done.
        if (!this.camera.online) {
            const errorMessage = "Unable to start video stream: the camera is offline or unavailable.";

            this.log.error(errorMessage);
            callback(new Error(this.camera.name + ": " + errorMessage));

            return;
        }

        // We transcode based in the following circumstances:
        //
        //   1. The user has explicitly configured transcoding.
        //   2. The user has configured cropping for the video stream.
        //   3. We are on a high latency streaming session (e.g. cellular). If we're high latency, we'll transcode by default unless the user has asked us not to. Why? It
        //      generally results in a speedier experience, at the expense of some stream quality (HomeKit tends to request far lower bitrates than Protect is capable of
        //      producing).
        //   4. The codec in use on the Protect camera isn't H.264.
        //
        // How do we determine if we're a high latency connection? We look at the RTP packet time of the audio packet time for a hint. HomeKit uses values of 20, 30, 40,
        // and 60ms. We make an assumption, validated by lots of real-world testing, that when we see 60ms used by HomeKit, it's a high latency connection and act
        // accordingly.
        const isHighLatency = request.audio.packet_time >= 60;
        const isTranscoding = this.camera.videoCodec !== "h264";

        // Set the initial bitrate we should use for this request based on what HomeKit is requesting.
        let targetBitrate = request.video.max_bit_rate;

        // If we're using the livestream API and we're timeshifting, we override the stream quality we've determined in favor of our timeshift buffer.
        let rtspStream: UnifiCameraStream | undefined;

        // Find the best RTSP stream based on what we're looking for.
        if (isTranscoding) {
            // If we have hardware transcoding enabled, we treat it uniquely and get the highest quality stream we can. Fixed-function hardware transcoders tend to perform
            // better with higher bitrate sources. Wel also want to generally bias ourselves toward higher quality streams where possible.
            // TODO: Allow for resolution instead of width/height to be passed!
            rtspStream ??= Unifi.getBestMatchingStream(this.camera.streams, this.ffmpegOptions.hostSystemMaxPixels/2, this.ffmpegOptions.hostSystemMaxPixels/2);

            // If we have specified the bitrates we want to use when transcoding, let's honor those here.
            if (isHighLatency && (PROTECT_TRANSCODE_HIGH_LATENCY_BITRATE > 0)) {
                targetBitrate = PROTECT_TRANSCODE_HIGH_LATENCY_BITRATE;
            } else if (!isHighLatency && (PROTECT_TRANSCODE_BITRATE > 0)) {
                targetBitrate = PROTECT_TRANSCODE_BITRATE;
            }

            // If we're targeting a bitrate that's beyond the capabilities of our input channel, match the bitrate of the input channel.
            if (rtspStream && (targetBitrate > (rtspStream.bitrate / 1000))) {
                targetBitrate = rtspStream.bitrate / 1000;
            }
        } else {
            rtspStream ??= Unifi.getBestMatchingStream(this.camera.streams, request.video.width, request.video.height);
        }

        if (!rtspStream) {
            const errorMessage = "Unable to start video stream: no valid RTSP stream profile was found.";

            this.log.error("%s %sx%s, %s fps, %s kbps.", errorMessage,
                request.video.width, request.video.height, request.video.fps, request.video.max_bit_rate.toLocaleString("en-US"));

            callback(new Error(this.camera.name + ": " + errorMessage));

            return;
        }

        // If we have the timeshift buffer enabled, and we've selected the same quality for the livestream as our timeshift buffer, we use the timeshift buffer to
        // significantly accelerate our livestream startup. Using the timeshift buffer has a few advantages.
        //
        // - Since we typically have several seconds of video already queued up in the timeshift buffer, FFmpeg will get a significant speed up in startup performance.
        //   FFmpeg takes time at the beginning of each session to analyze the input before allowing you to perform any action. By using the timeshift buffer, we're able to
        //   give FFmpeg all that data right at the beginning, effectively reducing that startup time to the point of being imperceptible.
        //
        // - Since we are using an already existing connection to the Protect controller, we don't need to create another connection which incurs an additional delay, as well
        //   as a resource hit on the Protect controller.
        const tsBuffer: Nullable<Buffer> = null;

        // -hide_banner                     Suppress printing the startup banner in FFmpeg.
        // -nostats                         Suppress printing progress reports while encoding in FFmpeg.
        // -fflags flags                    Set format flags to discard any corrupt packets rather than exit.
        // -err_detect ignore_err           Ignore decoding errors and continue rather than exit.
        // -max_delay 500000                Set an upper limit on how much time FFmpeg can take in demuxing packets, in microseconds.
        // -flags low_delay                 Tell FFmpeg to optimize for low delay / realtime decoding.
        // -r fps                           Set the input frame rate for the video stream.
        const ffmpegArgs = [
            "-hide_banner",
            "-nostats",
            "-fflags", "+discardcorrupt+genpts+igndts",
            "-err_detect", "ignore_err",
            ...this.ffmpegOptions.videoDecoder,
            "-max_delay", "500000",
            "-flags", "low_delay",
            "-r", rtspStream.fps.toString()
        ];

        // -probesize number              How many bytes should be analyzed for stream information. Use our configured defaults.
        // -avioflags direct              Tell FFmpeg to minimize buffering to reduce latency for more realtime processing.
        // -rtsp_transport tcp            Tell the RTSP stream handler that we're looking for a TCP connection.
        // -i rtspEntry.url               RTSPS URL to get our input stream from.
        ffmpegArgs.push(
            "-probesize", this.probesize.toString(),
            "-avioflags", "direct",
            "-rtsp_transport", "tcp",
            "-i", rtspStream.url
        );

        // -map 0:v:0                       selects the first available video track from the stream. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        ffmpegArgs.push(
            "-map", "0:v:0"
        );

        // Inform the user.
        this.log.info("Streaming request from %s%s: %sx%s@%sfps, %s kbps. %s %s, %s kbps [%s].",
            sessionInfo.address, (request.audio.packet_time === 60) ? " (high latency connection)" : "",
            request.video.width, request.video.height, request.video.fps, targetBitrate.toLocaleString("en-US"),
            isTranscoding ? (this.ffmpegOptions.hardwareTranscoding ? "Hardware accelerated transcoding" : "Transcoding") : "Using",
            rtspStream.name, (rtspStream.bitrate / 1000).toLocaleString("en-US"), "RTSP");

        // Check to see if we're transcoding. If we are, set the right FFmpeg encoder options. If not, copy the video stream.
        if (isTranscoding) {
            // Configure our video parameters for transcoding.
            ffmpegArgs.push(...this.ffmpegOptions.streamEncoder({
                bitrate: targetBitrate,
                fps: request.video.fps,
                height: request.video.height,
                idrInterval: PROTECT_HOMEKIT_IDR_INTERVAL,
                inputFps: rtspStream.fps,
                level: request.video.level,
                profile: request.video.profile,
                width: request.video.width
            }));
        } else {
            // Configure our video parameters for just copying the input stream from Protect - it tends to be quite solid in most cases:
            //
            // -vcodec copy                   Copy the stream withour reencoding it.
            ffmpegArgs.push(
                "-vcodec", "copy"
            );
        }

        // -reset_timestamps                Reset timestamps for this stream instead of accepting what Protect gives us.
        ffmpegArgs.push("-reset_timestamps", "1");

        // Add in any user-specified options for FFmpeg.
        if (this.platform.config.ffmpegOptions) {
            ffmpegArgs.push(...this.platform.config.ffmpegOptions);
        }

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
            "&pkt_size=" + request.video.mtu.toString()
        );

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports the audio codecs we need. Options we use are:
        //
        // -map 0:a:0?                      Selects the first available audio track from the stream, if it exists. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        // -acodec                          Encode using the codecs available to us on given platforms.
        // -profile:a 38                    Specify enhanced, low-delay AAC for HomeKit.
        // -flags +global_header            Sets the global header in the bitstream.
        // -f null                          Null filter to pass the audio unchanged without running through a muxing operation.
        // -ar samplerate                   Sample rate to use for this audio. This is specified by HomeKit.
        // -b:a bitrate                     Bitrate to use for this audio stream. This is specified by HomeKit.
        // -bufsize size                    This is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -ac number                       Set the number of audio channels.
        // -frame_size                      Set the number of samples per frame to match the requested frame size from HomeKit.
        if (sessionInfo.hasAudioSupport) {
            // Configure our audio parameters.
            ffmpegArgs.push(
                "-map", "0:a:0?",
                ...this.ffmpegOptions.audioEncoder,
                "-profile:a", "38",
                "-flags", "+global_header",
                "-f", "null",
                "-ar", request.audio.sample_rate.toString() + "k",
                "-b:a", request.audio.max_bit_rate.toString() + "k",
                "-bufsize", (2 * request.audio.max_bit_rate).toString() + "k",
                "-ac", request.audio.channel.toString(),
                "-frame_size", (request.audio.packet_time * request.audio.sample_rate).toString()
            );

            // If we are audio filtering, address it here.
            /*if (this.protectCamera.hasFeature("Audio.Filter.Noise")) {
                const afOptions = [];

                // See what the user has set for the afftdn filter for this camera.
                let fftNr = this.protectCamera.getFeatureFloat("Audio.Filter.Noise.FftNr") ?? PROTECT_FFMPEG_AUDIO_FILTER_FFTNR;

                // If we have an invalid setting, use the defaults.
                if ((fftNr < 0.01) || (fftNr > 97)) {
                    fftNr = (fftNr > 97) ? 97 : ((fftNr < 0.01) ? 0.01 : fftNr);
                }

                // The afftdn filter options we use are:
                //
                // nt=w  Focus on eliminating white noise.
                // om=o  Output the filtered audio.
                // tn=1  Enable noise tracking.
                // tr=1  Enable residual tracking.
                // nr=X  Noise reduction value in decibels.
                afOptions.push("afftdn=nt=w:om=o:tn=1:tr=1:nr=" + fftNr.toString());

                const highpass = this.protectCamera.getFeatureNumber("Audio.Filter.Noise.HighPass");
                const lowpass = this.protectCamera.getFeatureNumber("Audio.Filter.Noise.LowPass");

                // Only set the highpass and lowpass filters if the user has explicitly enabled them.
                if ((highpass !== null) && (highpass !== undefined)) {
                    afOptions.push("highpass=f=" + highpass.toString());
                }

                if ((lowpass !== null) && (lowpass !== undefined)) {
                    afOptions.push("lowpass=f=" + lowpass.toString());
                }

                // Return the assembled audio filter option.
                ffmpegArgs.push("-af", afOptions.join(", "));
            }*/

            // Add the required RTP settings and encryption for the stream:
            //
            // -payload_type num                Payload type for the RTP stream. This is negotiated by HomeKit and is usually 110 for AAC-ELD audio.
            // -ssrc                            synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
            // -f rtp                           Specify that we're using the RTP protocol.
            // -srtp_out_suite enc              Specify the output encryption encoding suites.
            // -srtp_out_params params          Specify the output encoding parameters. This is negotiated by HomeKit.
            // pkt_size                         Specify the size of each packet payload. HomeKit wants the block size for AAC-ELD to be 480 samples. That translates to a
            //                                  packet payload of 480 samples * 8 bits per byte / sample rate.
            ffmpegArgs.push(
                "-payload_type", request.audio.pt.toString(),
                "-ssrc", sessionInfo.audioSSRC.toString(),
                "-f", "rtp",
                "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
                "-srtp_out_params", sessionInfo.audioSRTP.toString("base64"),
                "srtp://" + sessionInfo.address + ":" + sessionInfo.audioPort.toString() + "?rtcpport=" + sessionInfo.audioPort.toString() + "&pkt_size=" +
                (3840 / request.audio.sample_rate).toString()
            );
        }

        // Additional logging, but only if we're debugging.
        if (this.platform.verboseFfmpeg || this.verboseFfmpeg) {
            ffmpegArgs.push("-loglevel", "level+verbose");
        }

        /*if (this.platform.config.debugAll) {
            ffmpegArgs.push("-loglevel", "level+debug");
        }*/

        // Combine everything and start an instance of FFmpeg.
        const ffmpegStream = new FfmpegStreamingProcess(this.platform, this, request.sessionID, ffmpegArgs, this.log,
            (sessionInfo.hasAudioSupport && this.camera.supportsTwoWayAudio) ? undefined :
                { addressVersion: sessionInfo.addressVersion, port: sessionInfo.videoReturnPort },
            callback);

        // Some housekeeping for our FFmpeg and demuxer sessions.
        this.ongoingSessions[request.sessionID] = {
            ffmpeg: [ffmpegStream],
            rtpDemuxer: sessionInfo.rtpDemuxer,
            rtpPortReservations: sessionInfo.rtpPortReservations,
            //toggleLight: flashlightService
        };

        delete this.pendingSessions[request.sessionID];

        // If we aren't doing two-way audio, we're done here. For two-way audio...we have some more plumbing to do.
        if (!sessionInfo.hasAudioSupport || !this.camera.supportsTwoWayAudio) {
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
        // b             Bandwidth information - application specific, 16k or 24k.
        // a=rtpmap      Payload type 110 corresponds to an MP4 stream. Format is MPEG4-GENERIC/<audio clock rate>/<audio channels>
        // a=fmtp        For payload type 110, use these format parameters.
        // a=crypto      Crypto suite to use for this session.
        const sdpReturnAudio = [
            "v=0",
            "o=- 0 0 IN " + sdpIpVersion + " 127.0.0.1",
            "s=" + this.camera.name + " Audio Talkback",
            "c=IN " + sdpIpVersion + " " + sessionInfo.address,
            "t=0 0",
            "m=audio " + sessionInfo.audioIncomingRtpPort.toString() + " RTP/AVP " + request.audio.pt.toString(),
            "b=AS:24",
            "a=rtpmap:110 MPEG4-GENERIC/" + ((request.audio.sample_rate === AudioStreamingSamplerate.KHZ_16) ? "16000" : "24000") + "/" + request.audio.channel.toString(),
            "a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=" +
            ((request.audio.sample_rate === AudioStreamingSamplerate.KHZ_16) ? "F8F0212C00BC00" : "F8EC212C00BC00"),
            "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:" + sessionInfo.audioSRTP.toString("base64")
        ].join("\n");

        // Configure the audio portion of the command line, if we have a version of FFmpeg supports the audio codecs we need. Options we use are:
        //
        // -hide_banner           Suppress printing the startup banner in FFmpeg.
        // -nostats               Suppress printing progress reports while encoding in FFmpeg.
        // -protocol_whitelist    Set the list of allowed protocols for this FFmpeg session.
        // -f sdp                 Specify that our input will be an SDP file.
        // -acodec                Decode AAC input using the specified decoder.
        // -i pipe:0              Read input from standard input.
        // -acodec                Encode to AAC. This format is set by Protect.
        // -flags +global_header  Sets the global header in the bitstream.
        // -ar                    Sets the audio rate to what Protect is expecting.
        // -b:a                   Bitrate to use for this audio stream based on what HomeKit is providing us.
        // -ac                    Sets the channel layout of the audio stream based on what Protect is expecting.
        // -f adts                Transmit an ADTS stream.
        // pipe:1                 Output the ADTS stream to standard output.
        const ffmpegReturnAudioCmd = [
            "-hide_banner",
            "-nostats",
            "-protocol_whitelist", "crypto,file,pipe,rtp,udp",
            "-f", "sdp",
            "-acodec", this.ffmpegOptions.audioDecoder,
            "-i", "pipe:0",
            "-map", "0:a:0",
            ...this.ffmpegOptions.audioEncoder,
            "-flags", "+global_header",
            "-ar", this.camera.talkbackSettings.samplingRate.toString(),
            "-b:a", request.audio.max_bit_rate.toString() + "k",
            "-ac", this.camera.talkbackSettings.channels.toString(),
            "-f", "adts",
            "pipe:1"
        ];

        // Additional logging, but only if we're debugging.
        if (this.platform.verboseFfmpeg || this.verboseFfmpeg) {
            ffmpegReturnAudioCmd.push("-loglevel", "level+verbose");
        }

        /*if (this.platform.config.debugAll) {
            ffmpegReturnAudioCmd.push("-loglevel", "level+debug");
        }*/

        try {
            // Now it's time to talkback.
            let ws: Nullable<WebSocket> = null;
            let isTalkbackLive = false;
            let dataListener: (data: Buffer) => void;
            let openListener: () => void;
            const wsCleanup = (): void => {

                // Close the websocket.
                if (ws?.readyState !== WebSocket.CLOSED) {
                    ws?.terminate();
                }
            };

            if (sessionInfo.talkBack) {

                // Open the talkback connection.
                ws = new WebSocket(sessionInfo.talkBack, { rejectUnauthorized: false });
                isTalkbackLive = true;

                // Catch any errors and inform the user, if needed.
                ws?.once("error", (error) => {
                    // Ignore timeout errors, but notify the user about anything else.
                    if (((error as NodeJS.ErrnoException).code !== "ETIMEDOUT") &&
                        !error.toString().startsWith("Error: WebSocket was closed before the connection was established")) {

                        this.log.error("Error in communicating with the return audio channel: %s", error);
                    }
                    // Clean up our talkback websocket.
                    wsCleanup();
                });

                // Catch any stray open events after we've closed.
                ws?.on("open", openListener = (): void => {
                    // If we've somehow opened after we've wrapped up talkback, terminate the connection.
                    if (!isTalkbackLive) {
                        // Clean up our talkback websocket.
                        wsCleanup();
                    }
                });

                // Cleanup after ourselves on close.
                ws?.once("close", () => {

                    ws?.off("open", openListener);
                });
            }

            // Wait for the first RTP packet to be received before trying to launch FFmpeg.
            if (sessionInfo.rtpDemuxer) {
                await once(sessionInfo.rtpDemuxer, "rtp");

                // If we've already closed the RTP demuxer, we're done here,
                if (!sessionInfo.rtpDemuxer.isRunning) {
                    // Clean up our talkback websocket.
                    wsCleanup();
                    return;
                }
            }

            // Fire up FFmpeg and start processing the incoming audio.
            const ffmpegReturnAudio = new FfmpegStreamingProcess(this.platform, this, request.sessionID, ffmpegReturnAudioCmd, this.log);

            // Setup housekeeping for the twoway FFmpeg session.
            this.ongoingSessions[request.sessionID].ffmpeg.push(ffmpegReturnAudio);

            // Feed the SDP session description to FFmpeg on stdin.
            ffmpegReturnAudio.stdin?.end(sdpReturnAudio + "\n");

            // Send the audio.
            ffmpegReturnAudio.stdout?.on("data", dataListener = (data: Buffer): void => {

                ws?.send(data, (error: Error | undefined): void => {
                    // This happens when an error condition is encountered on sending data to the websocket. We assume the worst and close our talkback channel.
                    if (error) {
                        wsCleanup();
                    }
                });
            });

            // Make sure we terminate the talkback websocket when we're done.
            ffmpegReturnAudio.ffmpegProcess?.once("exit", () => {
                // Make sure we catch any stray connections that may be too slow to open.
                isTalkbackLive = false;

                // Clean up our talkback websocket.
                wsCleanup();

                ffmpegReturnAudio.stdout?.off("data", dataListener);
            });
        } catch (error) {
            this.log.error("Unable to connect to the return audio channel: %s", error);
        }
    }

    // Process incoming stream requests.
    public async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
        switch (request.type) {
            case StreamRequestTypes.START:
                await this.startStream(request, callback);
                break;

            case StreamRequestTypes.RECONFIGURE:
                // Once FFmpeg is updated to support this, we'll enable this one.
                this.log.debug("Streaming parameters adjustment requested by HomeKit: %sx%s, %s fps, %s kbps.",
                    request.video.width, request.video.height, request.video.fps, request.video.max_bit_rate.toLocaleString("en-US"));
                callback();
                break;

            case StreamRequestTypes.STOP:
            default:
                this.stopStream(request.sessionID);
                callback();
                break;
        }
    }

    // Close a video stream.
    public stopStream(sessionId: string): void {
        try {
            // Stop any FFmpeg instances we have running.
            if (this.ongoingSessions[sessionId]) {
                this.ongoingSessions[sessionId].ffmpeg.map(ffmpegProcess => ffmpegProcess.stop());

                // Close the demuxer, if we have one.
                this.ongoingSessions[sessionId].rtpDemuxer?.close();

                // Turn off the flashlight on package cameras, if enabled. We explicitly want to call the set handler for the flashlight.
                this.ongoingSessions[sessionId].toggleLight?.setCharacteristic(this.hap.Characteristic.On, false);

                // Inform the user.
                this.log.info("Stopped video streaming session.");

                // Release our port reservations.
                this.ongoingSessions[sessionId].rtpPortReservations.map(x => this.platform.rtpPorts.cancel(x));
            }

            // On the off chance we were signaled to prepare to start streaming, but never actually started streaming, cleanup after ourselves.
            if (this.pendingSessions[sessionId]) {
                // Release our port reservations.
                this.pendingSessions[sessionId].rtpPortReservations.map(x => this.platform.rtpPorts.cancel(x));
            }

            // Delete the entries.
            delete this.pendingSessions[sessionId];
            delete this.ongoingSessions[sessionId];
        } catch (error) {
            this.log.error("Error occurred while ending the FFmpeg video processes: %s.", error);
        }
    }

    // Shutdown all our video streams.
    public shutdown(): void {
        for (const session of Object.keys(this.ongoingSessions)) {
            this.stopStream(session);
        }
    }

    // Adjust our probe hints.
    public adjustProbeSize(): void {
        if (this.probesizeOverrideTimeout) {
            clearTimeout(this.probesizeOverrideTimeout);
            this.probesizeOverrideTimeout = undefined;
        }

        // Maintain statistics on how often we need to adjust our probesize. If this happens too frequently, we will default to a working value.
        this.probesizeOverrideCount++;

        // Increase the probesize by a factor of two each time we need to do something about it. This idea is to balance the latency implications
        // for the user, but also ensuring we have a functional streaming experience.
        this.probesizeOverride = this.probesize * 2;

        // Safety check to make sure this never gets too crazy.
        if (this.probesizeOverride > 5000000) {
            this.probesizeOverride = 5000000;
        }

        this.log.error("The FFmpeg process ended unexpectedly due to issues with the media stream provided by the UniFi Protect livestream API. " +
            "Adjusting the settings we use for FFmpeg %s to use safer values at the expense of some additional streaming startup latency.",
            this.probesizeOverrideCount < 10 ? "temporarily" : "permanently");

        // If this happens often enough, keep the override in place permanently.
        if (this.probesizeOverrideCount < 10) {
            this.probesizeOverrideTimeout = setTimeout(() => {
                this.probesizeOverride = 0;
                this.probesizeOverrideTimeout = undefined;
            }, 1000 * 60 * 10);
        }
    }

    // Utility to return the currently set probesize for a camera.
    public get probesize(): number {
        return this.probesizeOverride ? this.probesizeOverride : 16384; // Or 32768
    }
}
