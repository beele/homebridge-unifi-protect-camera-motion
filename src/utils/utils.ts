import * as https from "https";
import {Logging, LogLevel} from "homebridge";

import type { Headers, Response, RequestInfo, RequestInit } from "node-fetch";

export class Utils {

    // Since Protect often uses self-signed certificates, we need to disable TLS validation.
    private static httpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    private static pause(duration: number): Promise<any> {
        return new Promise(res => setTimeout(res, duration));
    }

    public static async retry(retries: number, fn: () => Promise<any>, delay: number, retryCount: number = 0, lastError: any = null): Promise<any> {
        if (retryCount === retries) {
            throw lastError;
        }
        try {
            return Promise.resolve(await fn());
        } catch (e) {
            await this.pause(delay);
            return await this.retry(retries, fn, delay * 2, retryCount + 1, e);
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

        const nFetch = (await import('node-fetch')).default;

        let response: Response = await nFetch(url, options);
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
