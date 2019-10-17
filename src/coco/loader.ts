import {loadImage, createCanvas, Image} from "canvas";
import {createCocoModel, ObjectDetection} from "./coco";

export class Loader {

    public static async loadCoco(useLiteModel: boolean, basePath?:string): Promise<Detector> {
        const model: ObjectDetection = await createCocoModel(useLiteModel, basePath);
        const detector = {
            async detect(image: Image, logResults: boolean = false): Promise<Detection[]> {
                const start = Date.now();

                const canvas = Loader.createCanvasFromImage(image);
                const results = await model.detect(canvas);

                if (logResults) {
                    Loader.printProcessDuration('COCO', start);
                    Loader.printResults(results);
                }

                return Promise.resolve(results);
            }
        };
        return Promise.resolve(detector);
    }

    public static async createImage(pathOrUrl: string): Promise<Image> {
        try {
            return await loadImage(pathOrUrl);
        } catch (error) {
            throw new Error('Cannot load image!');
        }
    }

    public static createCanvasFromImage(image: Image): HTMLCanvasElement {
        const canvas: HTMLCanvasElement = createCanvas(image.width, image.height) as unknown as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image as unknown as HTMLImageElement, 0, 0, image.width, image.height);
        return canvas;
    }

    private static printProcessDuration(name: string, start: number): void {
        console.log(name + ' processing took: ' + (Date.now() - start) + 'ms');
    }

    private static printResults(results: any[]): void {
        for (const result of results) {
            console.log('==> Detected: ' + result.class + ' [' + Math.round(result.score * 100) + '%]');
        }
        console.log('');
    }
}

export interface Detection {
    class: string;
    score: number;
}

export interface Detector {
    detect(image: Image, logResults?: boolean): Promise<Detection[]>
}
