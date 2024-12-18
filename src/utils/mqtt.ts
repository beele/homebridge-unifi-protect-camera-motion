import {Logging} from "homebridge";
import { MqttClient } from "mqtt";

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
        this.client?.on('connect', () => {
            this.log.debug('Connected to MQTT broker');
        });
        this.client?.on('error', (error: Error) => {
            this.log.error('MQTT error: ' + error.message);
        });
    }

    public sendMessageOnTopic(message: string, topic: string): void {
        if (this.client?.connected) {
            this.client.publish(this.config.topicPrefix + '/' + topic, message);
        }
    }

    private onConnection(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let interval = setInterval(() => {
                if (this.client?.connected) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        });
    }

    public subscribeToTopic(topic: string, callback: (payload: {enabled: boolean}) => void): void {
        this.onConnection().then(() => {
            this.log.debug('Subscribing to: ' + this.config.topicPrefix + '/' + topic);
            this.client?.subscribe(this.config.topicPrefix + '/' + topic, (err, granted) => {
                console.log(granted);
                if (!err) {
                    if (granted && granted.length === 1) {
                        this.client?.on('message', (messageTopic, messagePayload, packet) => {
                            if (messageTopic === this.config.topicPrefix + '/' + topic) { 
                                callback(JSON.parse(messagePayload.toString()) as any);
                            }
                        });
                    }
                }
            });
        });
    }
}

export interface MqttConfig {
    broker: string;
    username: string;
    password: string;
    topicPrefix: string;
}
