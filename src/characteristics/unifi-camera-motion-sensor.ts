import {
    CharacteristicEventTypes,
    CharacteristicSetCallback,
    CharacteristicValue,
    HAP,
    Logging,
    PlatformAccessory,
} from "homebridge";
import {CameraConfig} from "../streaming/camera-config.js";
import { Mqtt } from "../utils/mqtt.js";

export class UnifiCameraMotionSensor {

    public static setupMotionSensor(cameraConfig: CameraConfig, accessory: PlatformAccessory, config: any, mqtt: Mqtt, hap: HAP, log: Logging): void {
        const Service = hap.Service;

        const motion = accessory.getService(hap.Service.MotionSensor);
        let motionSwitch = accessory.getServiceById(hap.Service.Switch, 'MotionEnabled');
        let motionTrigger = accessory.getServiceById(hap.Service.Switch, 'MotionTrigger');
        if (motion) {
            accessory.removeService(motion);
        }
        if (motionSwitch) {
            accessory.removeService(motionSwitch);
        }
        if (motionTrigger) {
            accessory.removeService(motionTrigger)
        }

        motionSwitch = new Service.Switch(cameraConfig.name + ' Motion enabled', 'MotionEnabled');
        accessory.addService(new Service.MotionSensor(cameraConfig.name + ' Motion sensor'));
        accessory.addService(motionSwitch);

        mqtt.subscribeToTopic(cameraConfig.name + '/set', (payload: {enabled: boolean}) => {
            if (payload && payload.enabled !== undefined) {
                accessory.context.motionEnabled = payload.enabled;
                log.info('Motion detection for ' + cameraConfig.name + ' has been turned ' + (accessory.context.motionEnabled ? 'ON' : 'OFF'));
            }
        });

        motionSwitch
            .getCharacteristic(hap.Characteristic.On)
            .on(hap.CharacteristicEventTypes.GET, (callback: CharacteristicSetCallback) => {
                callback(null, accessory.context.motionEnabled);
            })
            .on(hap.CharacteristicEventTypes.SET, (state: CharacteristicValue, callback: CharacteristicSetCallback) => {
                accessory.context.motionEnabled = state;
                mqtt.sendMessageOnTopic(JSON.stringify({enabled: accessory.context.motionEnabled}), cameraConfig.name + '/set');
                log.info('Motion detection for ' + cameraConfig.name + ' has been turned ' + (accessory.context.motionEnabled ? 'ON' : 'OFF'));
                callback();
            });

        if (config.unifi.enable_motion_trigger) {
            motionTrigger = new Service.Switch(cameraConfig.name + ' Motion trigger', 'MotionTrigger');
            accessory.addService(motionTrigger);
            motionTrigger
                .getCharacteristic(hap.Characteristic.On)
                .on(CharacteristicEventTypes.SET, (state: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    if (state) {
                        const motionSensor = accessory.getService(hap.Service.MotionSensor);
                        if (motionSensor) {
                            motionSensor.updateCharacteristic(hap.Characteristic.MotionDetected, 1);

                            /*setTimeout(() => {
                                log.debug('Motion trigger auto off');
                                motionTrigger?.getCharacteristic(hap.Characteristic.On).updateValue(false);
                            }, 1000);*/
                        }
                    }
                    callback(null, state);
                });
        }
    }
}
