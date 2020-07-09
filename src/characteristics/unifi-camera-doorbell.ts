import {
    CharacteristicEventTypes,
    CharacteristicSetCallback,
    CharacteristicValue,
    HAP,
    PlatformAccessory,
    Service
} from "homebridge";
import {CameraConfig} from "../streaming/camera-config";

export class UnifiCameraDoorbell {

    public static setupDoorbell(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, hap: HAP, infoLogger: Function, debugLogger: Function): void {
        const doorbell: Service = accessory.getService(hap.Service.Doorbell);
        let doorbellTrigger: Service = accessory.getServiceById(hap.Service.Switch, 'DoorbellTrigger');
        if (doorbell) {
            accessory.removeService(doorbell);
        }
        if (doorbellTrigger) {
            accessory.removeService(doorbellTrigger);
        }

        if (config.unifi.enable_doorbell) {
            doorbellTrigger = new Service.Switch(cameraConfig.name + ' Doorbell switch', 'DoorbellTrigger');
            accessory.addService(new Service.Doorbell(cameraConfig.name + ' Doorbell'));
            accessory.addService(doorbellTrigger);

            doorbellTrigger
                .getCharacteristic(hap.Characteristic.On)
                .on(CharacteristicEventTypes.SET, (state: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    if (state) {
                        const doorbell = accessory.getService(hap.Service.Doorbell);
                        if (doorbell) {
                            doorbell.updateCharacteristic(
                                hap.Characteristic.ProgrammableSwitchEvent,
                                hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
                            );

                            setTimeout(() => {
                                console.log('doorbell trigger auto off');
                                doorbellTrigger.getCharacteristic(hap.Characteristic.On).updateValue(false);
                            }, 1000);
                        }
                    }
                    callback(null, state);
                });
        }
    }
}