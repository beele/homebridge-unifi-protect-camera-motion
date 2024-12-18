import {HAP, PlatformAccessory, Service} from "homebridge";
import {UnifiCamera} from "../unifi/unifi.js";

export class UnifiCameraAccessoryInfo {

    public static createAccessoryInfo(camera: UnifiCamera, accessory: PlatformAccessory, hap: HAP): Service {
        const cameraAccessoryInfo: Service = accessory.getService(hap.Service.AccessoryInformation);
        if (cameraAccessoryInfo) {
            cameraAccessoryInfo.setCharacteristic(hap.Characteristic.Manufacturer, 'Ubiquiti');
            if (camera.type) {
                cameraAccessoryInfo.setCharacteristic(hap.Characteristic.Model, camera.type);
            }
            if (camera.mac) {
                cameraAccessoryInfo.setCharacteristic(hap.Characteristic.SerialNumber, camera.mac);
            }
            if (camera.firmware) {
                cameraAccessoryInfo.setCharacteristic(hap.Characteristic.FirmwareRevision, camera.firmware);
            }
        }
        return cameraAccessoryInfo;
    }
}
