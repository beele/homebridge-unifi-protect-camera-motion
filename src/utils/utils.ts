import * as https from "https";
import {Logging, LogLevel} from "homebridge";


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
