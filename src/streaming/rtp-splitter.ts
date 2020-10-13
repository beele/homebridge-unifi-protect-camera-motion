/* Copyright(C) 2017-2020, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * protect-rtp.ts: RTP-related utilities to slice and dice RTP streams.
 *
 * This module is heavily inspired by the homebridge and homebridge-camera-ffmpeg source code and
 * borrows heavily from both. Thank you for your contributions to the HomeKit world.
 *
 * Adjusted by Kevin Van den Abeele
 */
import {Logging} from 'homebridge';
import {createSocket} from 'dgram';
import getPort from 'get-port';
import {UnifiStreamingDelegate} from './unifi-streaming-delegate';

/*
 * Here's the problem this class solves: FFmpeg doesn't support multiplexing RTP and RTCP data on a single UDP port (RFC 5761).
 * If it did, we wouldn't need this workaround for HomeKit compatibility, which does multiplex RTP and RTCP over a single UDP port.
 *
 * This class inspects all packets coming in from inputPort and demultiplexes RTP and RTCP traffic to rtpPort and rtcpPort, respectively.
 *
 * Credit to @dgreif and @brandawg93 who graciously shared their code as a starting point, and their collaboration
 * in answering the questions needed to bring all this together. A special thank you to @Sunoo for the many hours of
 * discussion and brainstorming on this and other topics.
 */
export class RtpDemuxer {
    private delegate: UnifiStreamingDelegate;
    private heartbeatTimer!: NodeJS.Timeout;
    private heartbeatMsg!: Buffer;
    private log: Logging;
    private readonly inputPort: number;
    public readonly socket;

    // Create an instance of RTPSplitter.
    constructor(streamingDelegate: UnifiStreamingDelegate, ipFamily: ('ipv4' | 'ipv6'), inputPort: number, rtcpPort: number, rtpPort: number) {
        this.delegate = streamingDelegate;
        this.log = streamingDelegate.log;
        this.inputPort = inputPort;
        this.socket = createSocket(ipFamily === 'ipv6' ? 'udp6' : 'udp4');

        // Catch errors when they happen on our splitter.
        this.socket.on('error', (error) => {
            this.log.error('%s: RTPSplitter Error: %s', this.delegate.cameraName, error);
            this.socket.close();
        });

        // Split the message into RTP and RTCP packets.
        this.socket.on('message', (msg) => {
            // Send RTP packets to the RTP port.
            if (this.isRtpMessage(msg)) {
                this.socket.send(msg, rtpPort);
            } else {
                // Save this RTCP message for heartbeat purposes for the RTP port. This works because RTCP packets will be ignored
                // by ffmpeg on the RTP port, effectively providing a heartbeat to ensure FFmpeg doesn't timeout if there's an
                // extended delay between data transmission.
                this.heartbeatMsg = Buffer.from(msg);

                // Clear the old heartbeat timer.
                clearTimeout(this.heartbeatTimer);
                this.heartbeat(rtpPort);

                // RTCP control packets should go to the RTCP port.
                this.socket.send(msg, rtcpPort);
            }
        });

        // Take the socket live.
        this.socket.bind(this.inputPort);
    }

    // Send a regular heartbeat to FFmpeg to ensure the pipe remains open and the process alive.
    private heartbeat(port: number): void {
        // Clear the old heartbeat timer.
        clearTimeout(this.heartbeatTimer);

        // Send a heartbeat to FFmpeg every few seconds to keep things open. FFmpeg has a five-second timeout
        // in reading input, and we want to be comfortably within the margin for error to ensure the process
        // continues to run.
        this.heartbeatTimer = setTimeout(() => {
            this.socket.send(this.heartbeatMsg, port);
            this.heartbeat(port);
        }, 3.5 * 1000);
    }

    // Close the socket and cleanup.
    public close(): void {
        clearTimeout(this.heartbeatTimer);
        this.socket.close();
    }

    // Retrieve the payload information from a packet to discern what the packet payload is.
    private getPayloadType(message: Buffer): number {
        return message.readUInt8(1) & 0x7f;
    }

    // Return whether or not a packet is RTP (or not).
    private isRtpMessage(message: Buffer): boolean {
        const payloadType = this.getPayloadType(message);

        return (payloadType > 90) || (payloadType === 0);
    }
}

// RTP-related utilities.
export class RtpUtils {

    // Reserve consecutive ports for use with FFmpeg. FFmpeg currently lacks the ability to specify both the RTP
    // and RTCP ports. It always assumes, by convention, that when you specify an RTP port, the RTCP port is the
    // RTP port + 1. In order to work around that challenge, we need to always ensure that when we reserve multiple
    // ports for RTP (primarily for two-way audio) that we we are reserving consecutive ports only.
    public static async reservePorts(count = 1): Promise<number[]> {

        // Get the first port.
        const port = await getPort();
        const ports = [port];

        // If we're requesting additional consecutive ports, keep searching until they're found.
        for (let i = 1; i < count; i++) {
            const targetConsecutivePort = port + i;

            // We need to await here in order to determine whether we need to keep going.
            // eslint-disable-next-line no-await-in-loop
            const openPort = await getPort({port: targetConsecutivePort});

            // Unable to reserve the next consecutive port. Roll the dice again and hope for the best.
            if (openPort !== targetConsecutivePort) {
                return this.reservePorts(count);
            }

            ports.push(openPort);
        }

        return ports;
    }
}