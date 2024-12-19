import {Unifi, UnifiCameraStream} from "./unifi.js";

test('Unifi-generateStreamingUrlForBestMatchingResolution', async () => {
    const baseUrl: string = 'http://localhost:7447/';
    const streams: UnifiCameraStream[] = [
        {
            name: 'test1-name',
            alias: 'test1-alias',
            width: 640,
            height: 360,
            fps: 15,
            bitrate: 250,
            id: 1,
            url: baseUrl + 'test1-alias',
        },
        {
            name: 'test2-name',
            alias: 'test2-alias',
            width: 1024,
            height: 576,
            fps: 15,
            bitrate: 500,
            id: 2,
            url: baseUrl + 'test2-alias',
        },
        {
            name: 'test3-name',
            alias: 'test3-alias',
            width: 1920,
            height: 1080,
            fps: 15,
            bitrate: 1000,
            id: 3,
            url: baseUrl + 'test3-alias',
        }
    ];

    let matchingStream = Unifi.getBestMatchingStream(streams, 1280, 720);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test2-alias');

    matchingStream = Unifi.getBestMatchingStream(streams, 1024, 576);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test2-alias');

    matchingStream = Unifi.getBestMatchingStream(streams, 1920, 1080);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test3-alias');

    matchingStream = Unifi.getBestMatchingStream(streams, 3840, 2160);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test3-alias');

    matchingStream = Unifi.getBestMatchingStream(streams, 858, 480);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test1-alias');

    matchingStream = Unifi.getBestMatchingStream(streams, 640, 360);
    expect(matchingStream).not.toBeUndefined();
    expect(matchingStream!.url).toEqual('http://localhost:7447/test1-alias');

    return;
});
