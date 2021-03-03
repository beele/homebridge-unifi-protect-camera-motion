import {Canvas, Image} from "canvas";
import {ImageUtils} from "../../utils/image-utils";
import {load, ObjectDetection} from "./coco";
import {Logging} from "homebridge";

export class Loader {

    constructor(private readonly log: Logging) {
    }

    public async loadCoco(useFullModel: boolean = false): Promise<Detector> {
        const printProcessDuration: Function = (name: string, start: number) => {
            this.log.debug(name + ' processing took: ' + (Date.now() - start) + 'ms');
        };
        const printResults: Function = (results: any[]) => {
            if (results && results.length > 0) {
                for (const result of results) {
                    this.log.debug('==> Detected: ' + result.class + ' [' + Math.round(result.score * 100) + '%]');
                }
            } else {
               this.log.debug('Nothing detected!');
            }
        };

        const model: ObjectDetection = await load({base: useFullModel ? 'mobilenet_v2' : 'lite_mobilenet_v2'});
        return {
            async detect(image: Image): Promise<Detection[]> {
                const start = Date.now();

                const canvas: Canvas = ImageUtils.createCanvasFromImage(image);
                const results = await model.detect(canvas as unknown as HTMLCanvasElement);

                printProcessDuration('COCO', start);
                printResults(results);
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
