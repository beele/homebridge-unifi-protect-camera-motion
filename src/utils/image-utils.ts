const fs = require('fs');
const homebridgeDir = require('os').homedir() + '/.homebridge/';

import {Canvas, createCanvas, Image, loadImage} from "canvas";
import {Detection} from "../coco/loader";

export class ImageUtils {
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

    public static async saveAnnotatedImage(image: Image, detections: Detection[]): Promise<string> {
        const canvas: Canvas = ImageUtils.createCanvasFromImage(image);
        const ctx = canvas.getContext('2d');
        for (const detection of detections) {
            ImageUtils.drawRect(ctx, detection.bbox);
            ImageUtils.drawText(ctx, detection);
        }
        return await ImageUtils.saveImage(canvas);
    }

    public static async remove(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.unlink(path, () => {
                resolve();
            });
        });
    }

    private static drawRect(ctx: any, bbox: number[]): void {
        ctx.strokeStyle = 'rgba(255,0,0,1)';
        ctx.beginPath();
        ctx.rect(bbox[0], bbox[1], bbox[2], bbox[3]);
        ctx.stroke();
    }

    private static drawText(ctx: any, detection: Detection): void {
        ctx.font = '16px Arial';
        ctx.fillStyle = 'red';
        ctx.fillText(detection.class + ': ' + Math.round(detection.score * 100) + '%', detection.bbox[0] + 5, detection.bbox[1] + 15);
    }

    private static saveImage(canvas: Canvas): Promise<string> {
        return new Promise((resolve, reject) => {
            const snapshotName: string = 'snapshot-' + new Date().toISOString() + '.jpg';
            const out = fs.createWriteStream(homebridgeDir + snapshotName);
            const stream = canvas.createJPEGStream({
                quality: 0.95,
                chromaSubsampling: false
            });
            stream.pipe(out);
            out.on('error', (error: Error) => {
                reject('Cannot save image to disk: ' + error.message);
            });
            out.on('finish', () => {
                const fileName: string = homebridgeDir + snapshotName;
                console.log('The snapshot has been saved to: ' + fileName);
                resolve(fileName);
            });
        });
    }
}