import {Detection, Detector, Loader} from "../src/coco/loader";
import {Image} from "canvas";
import {ImageUtils} from "../src/utils/image-utils";

const path = require('path');
const fs = require('fs');

test('Loader-detect-image-full-model-IT', async () => {
    const detector: Detector = await Loader.loadCoco(false, path.dirname(path.resolve('resources')));
    await verifyDetections(detector);
});

test('Loader-detect-image-lite-model-IT', async () => {
    const detector: Detector = await Loader.loadCoco(true, path.dirname(path.resolve('resources')));
    await verifyDetections(detector);
});

const verifyDetections = async (detector: Detector) => {
    expect(detector).not.toBeNull();

    let image: Image = await ImageUtils.createImage(path.resolve('resources/images/test.jpg'));
    expect(image).not.toBeNull();

    let detections: Detection[] = await detector.detect(image, true);
    expect(detections).not.toBeNull();
    expect(detections.length).toBeGreaterThan(0);

    const fileName: string = await ImageUtils.saveAnnotatedImage(image, detections);
    let stats = fs.statSync(fileName);
    expect(stats.isFile()).toBeTruthy();

    fs.unlinkSync(fileName);
};