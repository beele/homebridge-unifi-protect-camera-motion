import {Canvas, Image} from "canvas";
import {ImageUtils} from "../utils/image-utils";

const assert = require("assert");
const path = require('path');
const fs = require('fs');

export class DetectionIntegrationTest {

    constructor() {
    }

    public async run(): Promise<void> {
        console.log('Loader-detect-image-full-model-IT');
        // TODO: Fix tests!
        /*
        let modelLoader: Loader = new Loader(this.mockLogging());
        let detector: Detector = await modelLoader.loadCoco(true);
        await this.verifyDetections(detector);

        console.log('Loader-detect-image-lite-model-IT');
        modelLoader = new Loader(this.mockLogging());
        detector = await modelLoader.loadCoco();
        await this.verifyDetections(detector);
        */
    }

    private async verifyDetections(): Promise<void> {
        /*
        //This is needed to run on a machine which does not have a .homebridge folder!
        const homebridgeDir = require('os').homedir() + '/.homebridge';
        ImageUtils.userStoragePath = homebridgeDir;
        if (!fs.existsSync(homebridgeDir)) {
            fs.mkdirSync(homebridgeDir);
        }

        let image: Image = await ImageUtils.createImage(path.resolve('../../resources/images/test.jpg'));
        assert(image !== null);

        let detections: Detection[] = await detector.detect(image, true);
        assert(detections !== null);
        assert(detections.length > 0);

        const annotatedImage: Canvas = await ImageUtils.generateAnnotatedImage(image, detections);
        const fileName: string = await ImageUtils.saveCanvasToFile(annotatedImage);
        let stats = fs.statSync(fileName);
        assert(stats.isFile() == true);

        fs.unlinkSync(fileName);
        */
    };

    private mockLogging(): any {
        return {
            info: ((message: string) => {
                console.log(message);
            }),
            debug: ((message: string) => {
                console.log(message);
            })
        }
    }
}

(async () => {
    const test = new DetectionIntegrationTest();
    await test.run();
})();
