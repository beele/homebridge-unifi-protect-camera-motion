import {createSocket} from 'dgram';
import getPort from 'get-port';
import {Logging} from 'homebridge';
import {UnifiStreamingDelegate} from './unifi-streaming-delegate';

export class RtpSplitter {
    private debug: (message: string, ...parameters: unknown[]) => void;
    private delegate: UnifiStreamingDelegate;
    private heartbeatTimer!: NodeJS.Timeout;
    private heartbeatMsg!: Buffer;
    private log: Logging;
    private serverPort: number;
    public readonly socket;

    constructor(streamingDelegate: UnifiStreamingDelegate, ipFamily: ('ipv4' | 'ipv6'), serverPort: number, returnAudioPort: number, twowayAudioPort: number) {
        this.delegate = streamingDelegate;
        this.log = streamingDelegate.log;
        this.serverPort = serverPort;
        this.socket = createSocket(ipFamily === 'ipv6' ? 'udp6' : 'udp4');

        this.socket.on('error', (error) => {
            this.log.error('%s: RTPSplitter Error: %s', this.delegate.cameraName, error);
            this.socket.close();
        });

        // Split the message into RTP and RTCP packets.
        this.socket.on('message', (msg) => {

            // Send RTP packets to the return audio port.
            if (this.isRtpMessage(msg)) {
                this.socket.send(msg, twowayAudioPort, '127.0.0.1');
            } else {

                // Save this RTCP message for heartbeat purposes for the return audio port.
                this.heartbeatMsg = Buffer.from(msg);

                // Clear the old heartbeat timer.
                clearTimeout(this.heartbeatTimer);
                this.heartbeat(twowayAudioPort);

                // RTCP control packets should go to the RTCP port.
                this.socket.send(msg, returnAudioPort, '127.0.0.1');
            }
        });

        this.debug('%s: Creating an RtpSplitter instance - inbound port: %s, twoway audio port: %s, return audio port: %s.',
            this.delegate.cameraName, this.serverPort, twowayAudioPort, returnAudioPort);

        // Take the socket live.
        this.socket.bind(this.serverPort);
    }

    // Send a regular heartbeat to FFmpeg to ensure the pipe remains open and the process alive.
    private heartbeat(port: number): void {

        // Clear the old heartbeat timer.
        clearTimeout(this.heartbeatTimer);

        // Send a heartbeat to FFmpeg every 3.5 seconds to keep things open. FFmpeg has a five-second timeout
        // in reading input, and we want to be comfortably within the margin for error to ensure the process
        // continues to run.
        this.heartbeatTimer = setTimeout(() => {
            this.debug('Sending ffmpeg a heartbeat.');

            this.socket.send(this.heartbeatMsg, port, '127.0.0.1');
            this.heartbeat(port);
        }, 3.5 * 1000);
    }

    // Close the socket and cleanup.
    public close(): void {
        this.debug('%s: Closing the RtpSplitter instance on port %s.', this.delegate.cameraName, this.serverPort);

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