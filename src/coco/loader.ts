import {Canvas, Image} from "canvas";
import {createCocoModel, ObjectDetection} from "./coco";
import {ImageUtils} from "../utils/image-utils";

export class Loader {

    private readonly logInfo: Function;

    constructor(infoLogger: Function) {
        this.logInfo = infoLogger;
    }

    public async loadCoco(useLiteModel: boolean, basePath?: string): Promise<Detector> {
        const printProcessDuration: Function = (name: string, start: number) => {
            this.logInfo(name + ' processing took: ' + (Date.now() - start) + 'ms');
        };
        const printResults: Function = (results: any[]) =>{
            for (const result of results) {
                this.logInfo('==> Detected: ' + result.class + ' [' + Math.round(result.score * 100) + '%]');
            }
        };

        const model: ObjectDetection = await createCocoModel(useLiteModel, basePath);
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
