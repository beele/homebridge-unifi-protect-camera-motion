import {Canvas, Image} from "canvas";
import {ImageUtils} from "../../utils/image-utils";
import {load, ObjectDetection} from "./coco";
import {Logging} from "homebridge";

export class Loader {

    constructor(private readonly log: Logging) {
        
    }

    public async loadCoco(): Promise<Detector> {
        const printProcessDuration: Function = (name: string, start: number) => {
            this.log.info(name + ' processing took: ' + (Date.now() - start) + 'ms');
        };
        const printResults: Function = (results: any[]) => {
            for (const result of results) {
                this.log.info('==> Detected: ' + result.class + ' [' + Math.round(result.score * 100) + '%]');
            }
        };

        const model: ObjectDetection = await load();
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
