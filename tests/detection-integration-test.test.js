"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const loader_1 = require("../src/coco/loader");
const path = require("path");
test('Loader-test-1', () => __awaiter(void 0, void 0, void 0, function* () {
    const detector = yield loader_1.Loader.loadCoco(false, path.dirname(require.resolve('homebridge-unifi-protect-camera-motion/package.json')));
    expect(detector).not.toBeNull();
}));
//# sourceMappingURL=detection-integration-test.test.js.map