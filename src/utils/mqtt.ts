import {MqttClient} from "mqtt/types/lib/client";
import {Logging} from "homebridge";

const mqtt = require('mqtt');

export class Mqtt {

    private readonly log: Logging;
    private readonly config: MqttConfig;
    private readonly client: MqttClient;

    constructor(config: MqttConfig, log: Logging) {
        this.log = log;
        this.config = config;

        if (!config || !config.broker) {
            return;
        }

        const options: {username?: string, password?: string} = {};
        if (config.username) {
            options.username = config.username;

            if (config.password) {
                options.password = config.password;
            }
        }

        this.client = mqtt.connect(config.broker, options);
        this.client.on('connect', () => {
            this.log.debug('Connected to MQTT broker');
        });
        this.client.on('error', (error: Error) => {
            this.log.error('MQTT error: ' + error.message);
        });
    }

    public sendMessageOnTopic(message: string, topic: string) {
        if (this.client && this.client.connected) {
            this.client.publish(this.config.topicPrefix + '/' + topic, message);
        }
    }
}

export interface MqttConfig {
    broker: string;
    username: string;
    password: string;
    topicPrefix: string;
}
