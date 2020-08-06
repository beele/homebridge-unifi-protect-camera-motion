import * as https from "https";
import fetch, { Headers, Response, RequestInfo, RequestInit } from "node-fetch";
import {Logging, LogLevel} from "homebridge";

export class Utils {

    // Since Protect often uses self-signed certificates, we need to disable TLS validation.
    private static httpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    public static pause(duration: number): Promise<any> {
        return new Promise(res => setTimeout(res, duration));
    }

    public static async backOff(retries: number, promise: Promise<any>, delay: number): Promise<any> {
        delay = delay / 2;
        for (let i = 0; i <= retries; i++) {
            try {
                return await promise;
            } catch (err) {
                delay = delay * 2;
                await this.pause(delay);
            }
        }
    }

    public static async fetch(url: RequestInfo, options: RequestInit, headers: Headers, networkLogger: Logging = this.fakeLogging()): Promise<Response> {
        options.agent = this.httpsAgent;
        options.headers = headers;

        networkLogger.debug('Calling: ' + url);
        networkLogger.debug('Method: ' + options.method);
        networkLogger.debug('With headers: ' + JSON.stringify(options.headers, null, 4));
        if (options.body) {
           networkLogger.debug('Body: ' + JSON.stringify(options.body, null, 4));
        }

        let response: Response = await fetch(url, options);
        networkLogger.debug('Response: \n'  + JSON.stringify(response, null, 4));

        if (response.status === 401) {
            throw new Error('Invalid credentials');
        }
        if (response.status === 403) {
            throw new Error('Access Forbidden');
        }
        if (!response.ok) {
            throw new Error('Invalid response: ' + response);
        }
        return response;
    }

    public static fakeLogging(): Logging {
        // @ts-ignore
        return {
            prefix: "FAKE_LOGGING",
            error(message: string, ...parameters: any[]): void {},
            info(message: string, ...parameters: any[]): void {},
            log(level: LogLevel, message: string, ...parameters: any[]): void {},
            warn(message: string, ...parameters: any[]): void {},
            debug(message: string, ...parameters: any[]): void {},
        }
    }
}
