import {Unifi, UnifiCameraStream} from "./unifi.js";

test('Unifi-generateStreamingUrlForBestMatchingResolution', async () => {
    const baseUrl: string = 'http://localhost:7447/';
    const streams: UnifiCameraStream[] = [
        {
            name: 'test1-name',
            alias: 'test1-alias',
            width: 640,
            height: 360,
            fps: 15
        },
        {
            name: 'test2-name',
            alias: 'test2-alias',
            width: 1024,
            height: 576,
            fps: 15
        },
        {
            name: 'test3-name',
            alias: 'test3-alias',
            width: 1920,
            height: 1080,
            fps: 15
        }
    ];

    let matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 1280, 720);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test2-alias');

    matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 1024, 576);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test2-alias');

    matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 1920, 1080);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test3-alias');

    matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 3840, 2160);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test3-alias');

    matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 858, 480);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test1-alias');

    matchingResolutionUrl = Unifi.generateStreamingUrlForBestMatchingResolution(baseUrl, streams, 640, 360);
    expect(matchingResolutionUrl).not.toBeNull();
    expect(matchingResolutionUrl).toEqual('http://localhost:7447/test1-alias');

    return;
});
