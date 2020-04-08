export class Utils {

    public static pause(duration: number): Promise<any> {
        return new Promise(res => setTimeout(res, duration));
    }

    public static async backoff(retries: number, promise: Promise<any>, delay: number): Promise<any> {
        delay = delay / 2;
        for (let i = 0; i <= retries; i++) {
            try {
                return await promise;
            } catch (err) {
                delay = delay * 2;
                console.log('Retrying, Waiting', delay, 'ms...');
                await this.pause(delay);
            }
        }
    }

    public static checkResponseForErrors(response: any, fieldToCheck: string, subFields: string[] = []): void {
        if (!response) {
            throw new Error('No response received!');
        }

        if (!response[fieldToCheck]) {
            throw new Error('Invalid response, missing: ' + fieldToCheck);

        } else if(response[fieldToCheck].error) {
            throw new Error('Error in response: ' + response[fieldToCheck].error);

        } else if(subFields && subFields.length > 0) {
            for (const subField of subFields) {
                if(!response[fieldToCheck][subField]) {
                    throw new Error('Invalid response, missing: ' + subField + ' on ' + fieldToCheck);
                }
            }
        }
    }

    public static createLogger(wrappedLogger: Function, debug: boolean): Function {
        return (message: any) => {
            if(debug) {
                wrappedLogger(JSON.stringify(message, null, 4));
            }
        }
    }
}
