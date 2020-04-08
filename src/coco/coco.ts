/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tf from '@tensorflow/tfjs-node'

import {CLASSES} from './classes';
import {resolve} from "path";

export interface DetectedObject {
    bbox: [number, number, number, number];  // [x, y, width, height]
    class: string;
    score: number;
}

export async function createCocoModel(useLiteModel: boolean, basePath: string = '.') {
    const objectDetection = new ObjectDetection(basePath, useLiteModel ? 'mobilenet_v2_lite' : 'mobilenet_v2');
    await objectDetection.load();
    return objectDetection;
}

export class ObjectDetection {
    private readonly modelPath: string;
    private model: tf.GraphModel;

    constructor(basePath: string, modelName: string) {
        this.modelPath = basePath + '/resources/models/coco/' + modelName;
    }

    async load() {
        this.model = await tf.loadGraphModel('file://' + resolve(this.modelPath) + '/model.json');

        // Warmup the model.
        const result = await this.model.executeAsync(tf.zeros([1, 300, 300, 3], 'int32')) as
            tf.Tensor[];
        result.map(async (t) => await t.data());
        result.map(async (t) => t.dispose());
    }

    /**
     * Detect objects for an image returning a list of bounding boxes with
     * associated class and score.
     *
     * @param img The image to detect objects from. Can be a tensor or a DOM
     *     element image, video, or canvas.
     * @param maxNumBoxes The maximum number of bounding boxes of detected
     * objects. There can be multiple objects of the same class, but at different
     * locations. Defaults to 20.
     *
     */
    async detect(
        img: tf.Tensor3D | ImageData | HTMLImageElement | HTMLCanvasElement |
            HTMLVideoElement,
        maxNumBoxes = 20): Promise<DetectedObject[]> {
        return this.infer(img, maxNumBoxes);
    }

    /**
     * Dispose the tensors allocated by the model. You should call this when you
     * are done with the model.
     */
    dispose() {
        if (this.model) {
            this.model.dispose();
        }
    }

    /**
     * Infers through the model.
     *
     * @param img The image to classify. Can be a tensor or a DOM element image,
     * video, or canvas.
     * @param maxNumBoxes The maximum number of bounding boxes of detected
     * objects. There can be multiple objects of the same class, but at different
     * locations. Defaults to 20.
     */
    private async infer(
        img: tf.Tensor3D | ImageData | HTMLImageElement | HTMLCanvasElement |
            HTMLVideoElement,
        maxNumBoxes: number): Promise<DetectedObject[]> {
        const batched = tf.tidy(() => {
            if (!(img instanceof tf.Tensor)) {
                img = tf.browser.fromPixels(img);
            }
            // Reshape to a single-element batch so we can pass it to executeAsync.
            return img.expandDims(0);
        });
        const height = batched.shape[1];
        const width = batched.shape[2];

        // model returns two tensors:
        // 1. box classification score with shape of [1, 1917, 90]
        // 2. box location with shape of [1, 1917, 1, 4]
        // where 1917 is the number of box detectors, 90 is the number of classes.
        // and 4 is the four coordinates of the box.
        const result = await this.model.executeAsync(batched) as tf.Tensor[];

        const scores = result[0].dataSync() as Float32Array;
        const boxes = result[1].dataSync() as Float32Array;

        // clean the webgl tensors
        batched.dispose();
        tf.dispose(result);

        const [maxScores, classes] =
            this.calculateMaxScores(scores, result[0].shape[1], result[0].shape[2]);

        const indexTensor = tf.tidy(() => {
            const boxes2 =
                tf.tensor2d(boxes, [result[1].shape[1], result[1].shape[3]]);
            return tf.image.nonMaxSuppression(
                boxes2, maxScores, maxNumBoxes, 0.5, 0.5);
        });

        const indexes = indexTensor.dataSync() as Float32Array;
        indexTensor.dispose();

        return this.buildDetectedObjects(
            width, height, boxes, maxScores, indexes, classes);
    }

    private buildDetectedObjects(
        width: number, height: number, boxes: Float32Array, scores: number[],
        indexes: Float32Array, classes: number[]): DetectedObject[] {
        const count = indexes.length;
        const objects: DetectedObject[] = [];
        for (let i = 0; i < count; i++) {
            const bbox = [];
            for (let j = 0; j < 4; j++) {
                bbox[j] = boxes[indexes[i] * 4 + j];
            }
            const minY = bbox[0] * height;
            const minX = bbox[1] * width;
            const maxY = bbox[2] * height;
            const maxX = bbox[3] * width;
            bbox[0] = minX;
            bbox[1] = minY;
            bbox[2] = maxX - minX;
            bbox[3] = maxY - minY;
            objects.push({
                bbox: bbox as [number, number, number, number],
                class: CLASSES[classes[indexes[i]] + 1].displayName,
                score: scores[indexes[i]]
            });
        }
        return objects;
    }

    private calculateMaxScores(
        scores: Float32Array, numBoxes: number,
        numClasses: number): [number[], number[]] {
        const maxes = [];
        const classes = [];
        for (let i = 0; i < numBoxes; i++) {
            let max = Number.MIN_VALUE;
            let index = -1;
            for (let j = 0; j < numClasses; j++) {
                if (scores[i * numClasses + j] > max) {
                    max = scores[i * numClasses + j];
                    index = j;
                }
            }
            maxes[i] = max;
            classes[i] = index;
        }
        return [maxes, classes];
    }
}
