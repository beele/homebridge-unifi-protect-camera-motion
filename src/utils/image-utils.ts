import fs from 'fs';
import {Canvas, createCanvas, Image, loadImage} from "canvas";
import { Detection } from "../motion/motion.js";

export class ImageUtils {

    public static userStoragePath: string;

    public static async createImage(pathOrUrl: string): Promise<Image> {
        try {
            return await loadImage(pathOrUrl);
        } catch (error) {
            throw new Error('Cannot load image!');
        }
    }

    public static createCanvasFromImage(image: Image): Canvas {
        const canvas: Canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, image.width, image.height);
        return canvas;
    }

    public static resizeCanvas(inputCanvas: Canvas, targetWidth: number, targetHeight: number): Canvas {
        const canvas: Canvas = createCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (inputCanvas) {
            ctx.drawImage(inputCanvas, 0, 0, inputCanvas.width, inputCanvas.height, 0, 0, targetWidth, targetHeight);
        }
        return canvas;
    }

    public static async generateAnnotatedImage(image: Image, detections: Detection[]): Promise<Canvas> {
        const canvas: Canvas = ImageUtils.createCanvasFromImage(image);
        const ctx = canvas.getContext('2d');
        for (const detection of detections) {
            ImageUtils.drawRect(ctx, detection.bbox);
            ImageUtils.drawText(ctx, detection);
        }
        return canvas;
    }

    public static async remove(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.unlink(path, () => {
                resolve();
            });
        });
    }

    public static saveCanvasToFile(canvas: Canvas): Promise<string> {
        return new Promise((resolve, reject) => {
            const snapshotName: string = 'snapshot-' + new Date().toISOString() + '.jpg';
            const out = fs.createWriteStream(this.userStoragePath + '/' + snapshotName);
            const stream = canvas.createJPEGStream({
                quality: 0.95,
                chromaSubsampling: false
            });
            stream.pipe(out);
            out.on('error', (error: Error) => {
                reject('Cannot save image to disk: ' + error.message);
            });
            out.on('finish', () => {
                const fileName: string = this.userStoragePath + '/' + snapshotName;
                resolve(fileName);
            });
        });
    }

    private static drawRect(ctx: any, bbox: number[]): void {
        ctx.strokeStyle = 'rgba(255,0,0,1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(bbox[0], bbox[1], bbox[2], bbox[3]);
        ctx.stroke();
    }

    private static drawText(ctx: any, detection: Detection): void {
        ctx.font = '16px Arial';
        ctx.fillStyle = 'red';
        ctx.fillText(detection.class + ': ' + Math.round(detection.score * 100) + '%', detection.bbox[0] + 5, detection.bbox[1] + 15);
    }
}
