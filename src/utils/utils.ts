import * as https from "https";
import fetch, { Headers, Response, RequestInfo, RequestInit } from "node-fetch";

export class Utils {

    //Since Protect often uses self-signed certificates, we need to disable TLS validation.
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

    public static async fetch(url: RequestInfo, options: RequestInit, headers: Headers): Promise<Response> {
        options.agent = this.httpsAgent;
        options.headers = headers;

        let response: Response = await fetch(url, options);
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
}
