import {Canvas, Image} from "canvas";
import { Detection } from "../motion/motion.js";
import {ImageUtils} from "../utils/image-utils.js";

const assert = require("assert");
const path = require('path');
const fs = require('fs');

export class DetectionIntegrationTest {

    constructor() {
    }

    public async run(): Promise<void> {
        console.log('Loader-detect-image');
        // TODO: Implement new test for python based detector!
        // await this.verifyDetections(detector);
    }

    private async verifyDetections(): Promise<void> {
        //This is needed to run on a machine which does not have a .homebridge folder!
        const homebridgeDir = require('os').homedir() + '/.homebridge';
        ImageUtils.userStoragePath = homebridgeDir;
        if (!fs.existsSync(homebridgeDir)) {
            fs.mkdirSync(homebridgeDir);
        }

        let image: Image = await ImageUtils.createImage(path.resolve('../../resources/images/test.jpg'));
        assert(image !== null);

        let detections: Detection[] = []; // TODO: Perform detection
        assert(detections !== null);
        assert(detections.length > 0);

        const annotatedImage: Canvas = await ImageUtils.generateAnnotatedImage(image, detections);
        const fileName: string = await ImageUtils.saveCanvasToFile(annotatedImage);
        let stats = fs.statSync(fileName);
        assert(stats.isFile() == true);

        fs.unlinkSync(fileName);
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
