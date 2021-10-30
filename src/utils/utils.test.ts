import {Utils} from "./utils";

test('Utils-backOff-fail', async (): Promise<void> => {
    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            reject('rejected');
        });
    }

    return new Promise((resolve, reject) => {
        Utils
        .retry(3, fn, 100)
        .then((result) => {
            reject('Should not revolve! (' + result + ')');
        })
        .catch((error) => {
            expect(error).toEqual('rejected');
            resolve();
        });
    });
});

test('Utils-backOff-success-first-try', async (): Promise<void> => {
    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            resolve('success');
        });
    };

    return new Promise((resolve, reject) => {
        Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            resolve()
        })
        .catch((error) => {
            reject('Should not reject! (' + error + ')');
        });
    });
});

test('Utils-backOff-success-second-try', async (): Promise<void> => {
    const counterWrapper: {count: number} = {count: 1};

    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (counterWrapper.count === 2) {
                resolve('success');
            } else {
                reject('rejected');
                counterWrapper.count++;
            }
        });
    };

    return new Promise((resolve, reject) => {
        Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            expect(counterWrapper.count).toEqual(2);
            resolve();
        })
        .catch((error) => {
            reject('Should not reject! (' + error + ')');
        });
    });
});

test('Utils-backOff-success-third-try', async (): Promise<void> => {
    const counterWrapper: {count: number} = {count: 1};

    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (counterWrapper.count === 3) {
                resolve('success');
            } else {
                reject('rejected');
                counterWrapper.count++;
            }
        });
    };

    return new Promise((resolve, reject) => {
        Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            expect(counterWrapper.count).toEqual(3);
            resolve();
        })
        .catch((error) => {
            reject('Should not reject! (' + error + ')');
        });
    });
});

