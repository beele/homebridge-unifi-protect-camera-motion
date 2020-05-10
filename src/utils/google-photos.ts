import {IncomingMessage, ServerResponse} from "http";
import {google} from "googleapis";
import { OAuth2Client } from 'google-auth-library';

const http = require('http');
const fs = require('fs');
const {promisify} = require('util');

const Photos = require('googlephotos');

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

const homebridgeDir: string = (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) + '/.homebridge/';

export class GooglePhotos {

    private readonly log: Function;
    private oauth2Client: OAuth2Client;

    private gPhotosConfig: gPhotosConfig = {
        auth_clientId: null,
        auth_clientSecret: null,
        auth_redirectUrl: null,
        auth_refresh_token: null,
        albumId: null
    };

    private configIsInvalid = false;

    constructor(logger: Function) {
        this.log = logger;

        setTimeout(async () => {
            await this.init();
        })
    }

    private async init(): Promise<void> {
        try {
            this.gPhotosConfig = await GooglePhotos.readConfig();
        } catch (error) {
            this.log('Google photos config cannot be read/parsed, functionality disabled!');
            this.log(error);
            this.configIsInvalid = true;
        }
        this.log(this.gPhotosConfig);

        this.oauth2Client = new google.auth.OAuth2(
            this.gPhotosConfig.auth_clientId,
            this.gPhotosConfig.auth_clientSecret,
            this.gPhotosConfig.auth_redirectUrl
        );

        const photos = new Photos(await this.authenticate());
        try {
            if (!this.gPhotosConfig.albumId) {
                this.log('Creating album');
                const response = await photos.albums.create('Homebridge-Unifi-Protect-Motion-Captures');
                this.gPhotosConfig.albumId = response.id;
            } else {
                this.log('Album already created');
            }
            await GooglePhotos.writeConfig(this.gPhotosConfig);
        } catch (error) {
            this.log('Could not create album');
            this.log(error);
        }
    }

    public async uploadImage(imagePath: string, imageName: string, description: string): Promise<string> {
        if (this.configIsInvalid) {
            return null;
        }

        try {
            const photos = new Photos(await this.authenticate());
            const response = await photos.mediaItems.upload(this.gPhotosConfig.albumId, imageName, imagePath, description);
            return response.newMediaItemResults[0].mediaItem.productUrl;

        } catch (error) {
            this.log('Uploading failed');
            this.log(error);
            throw new Error('Cannot upload image!');
        }
    }

    private async authenticate(): Promise<string> {
        if (!this.gPhotosConfig.auth_refresh_token) {
            //Open this url and follow the instructions!
            const url = this.oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: [Photos.Scopes.READ_AND_APPEND]
            });
            console.log('Please log in on Google Photos to allow for uploading: ' + url);
        } else {
            this.oauth2Client.setCredentials({
                refresh_token: this.gPhotosConfig.auth_refresh_token
            });
        }

        let accessToken = null;
        try {
            //TODO: only refresh if token is about to expire!
            if (this.gPhotosConfig.auth_refresh_token) {
                this.log('Refreshing access token');
                accessToken = (await this.oauth2Client.getAccessToken()).token;
            } else {
                this.log('Fetching new access token');
                const {tokens} = await this.oauth2Client.getToken(await this.getAuthCodeFromOauth2callback());
                this.oauth2Client.setCredentials(tokens);
                if (tokens.refresh_token) {
                    this.gPhotosConfig.auth_refresh_token = tokens.refresh_token;
                }
                this.log(tokens);
                accessToken = tokens.access_token;
            }

            return accessToken;
        } catch (error) {
            this.log('Failed to get auth!');
            this.log(error);
        }
    }

    private getAuthCodeFromOauth2callback(): Promise<string> {
        return new Promise((resolve, reject) => {
            const requestHandler = (request: IncomingMessage, response: ServerResponse) => {
                response.statusCode = 200;
                response.setHeader('Content-Type', 'text/plain');

                const url = new URL('http://localhost' + request.url);
                if (url.pathname === '/oauth2-callback') {
                    response.end('OAuth2 callback handled!');
                    server.close();
                    resolve(url.searchParams.get('code'));
                } else {
                    response.end('OAuth2 callback handler running...');
                }
            };

            const server = http.createServer(requestHandler).listen(8080);
        });
    }

    private static async readConfig(): Promise<gPhotosConfig> {
        return JSON.parse(await readFileAsync(homebridgeDir + 'unifi-protect-google-settings.json'));
    }

    private static async writeConfig(config: gPhotosConfig): Promise<void> {
        return writeFileAsync(homebridgeDir + 'unifi-protect-google-settings.json', JSON.stringify(config, null, 4));
    }
}

export interface gPhotosConfig {
    auth_clientId: string;
    auth_clientSecret: string;
    auth_redirectUrl: string;
    auth_refresh_token: string;
    albumId: string;
}