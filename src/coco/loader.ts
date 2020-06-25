import {Canvas, Image} from "canvas";
import {ImageUtils} from "../utils/image-utils";
import {ObjectDetection} from "@tensorflow-models/coco-ssd";

const cocoSsd = require('@tensorflow-models/coco-ssd');

export class Loader {

    private readonly logInfo: Function;

    constructor(infoLogger: Function) {
        this.logInfo = infoLogger;
    }

    public async loadCoco(): Promise<Detector> {
        const printProcessDuration: Function = (name: string, start: number) => {
            this.logInfo(name + ' processing took: ' + (Date.now() - start) + 'ms');
        };
        const printResults: Function = (results: any[]) =>{
            for (const result of results) {
                this.logInfo('==> Detected: ' + result.class + ' [' + Math.round(result.score * 100) + '%]');
            }
        };

        const model: ObjectDetection = await cocoSsd.load();
        return {
            async detect(image: Image, logResults: boolean = false): Promise<Detection[]> {
                const start = Date.now();

                const canvas: Canvas = ImageUtils.createCanvasFromImage(image);
                const results = await model.detect(canvas as unknown as HTMLCanvasElement);

                if (logResults) {
                    printProcessDuration('COCO', start);
                    printResults(results);
                }
                return results;
            }
        };
    }
}

export interface Detection {
    class: string;
    score: number;
    bbox: number[];
}

export interface Detector {
    detect(image: Image, logResults?: boolean): Promise<Detection[]>
}
