import {Utils} from "./utils";

test('Utils-backOff-fail', async (done: Function) => {
    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            reject('rejected');
        });
    }

    Utils
        .retry(3, fn, 100)
        .then((result) => {
            fail('Should not revolve! (' + result + ')');
        })
        .catch((error) => {
            expect(error).toEqual('rejected');
            done();
        });
});

test('Utils-backOff-success-first-try', async (done: Function) => {
    const fn: () => Promise<any> = (): Promise<any> => {
        return new Promise((resolve, reject) => {
            resolve('success');
        });
    };

    Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            done();
        })
        .catch((error) => {
            fail('Should not reject! (' + error + ')');
        });
});

test('Utils-backOff-success-second-try', async (done: Function) => {
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

    Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            expect(counterWrapper.count).toEqual(2);
            done();
        })
        .catch((error) => {
            fail('Should not reject! (' + error + ')');
        });
});

test('Utils-backOff-success-third-try', async (done: Function) => {
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

    Utils
        .retry(3, fn, 100)
        .then((result) => {
            expect(result).toEqual('success');
            expect(counterWrapper.count).toEqual(3);
            done();
        })
        .catch((error) => {
            fail('Should not reject! (' + error + ')');
        });
});

