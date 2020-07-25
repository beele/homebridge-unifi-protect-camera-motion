import {
    CharacteristicEventTypes,
    CharacteristicSetCallback,
    CharacteristicValue,
    HAP,
    Logging,
    PlatformAccessory
} from "homebridge";
import {CameraConfig} from "../streaming/camera-config";

export class UnifiCameraDoorbell {

    public static setupDoorbell(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, hap: HAP, log: Logging): void {
        const Service = hap.Service;

        const doorbell = accessory.getService(hap.Service.Doorbell);
        let doorbellTrigger = accessory.getServiceById(hap.Service.Switch, 'DoorbellTrigger');
        if (doorbell) {
            accessory.removeService(doorbell);
        }
        if (doorbellTrigger) {
            accessory.removeService(doorbellTrigger);
        }

        if (config.unifi.enable_doorbell_for && config.unifi.enable_doorbell_for.includes(cameraConfig.camera.id)) {
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
                                log.debug('Doorbell trigger auto off');
                                doorbellTrigger.getCharacteristic(hap.Characteristic.On).updateValue(false);
                            }, 1000);
                        }
                    }
                    callback(null, state);
                });
        }
    }
}