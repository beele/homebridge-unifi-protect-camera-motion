import {IncomingMessage, ServerResponse} from "http";
import {google} from "googleapis";
import {OAuth2Client} from 'google-auth-library';
import {Logging} from "homebridge";

const http = require('http');
const fs = require('fs');
const {promisify} = require('util');

const Photos = require('googlephotos');

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

export class GooglePhotos {

    private readonly log: Logging;
    private readonly logDebug: Function;
    private readonly config: GooglePhotosConfig;
    private readonly userStoragePath: string;
    private oauth2Client: OAuth2Client;

    private gPhotosPersistData: GooglePhotosPersistData;

    private initPerformed = false;

    constructor(config: GooglePhotosConfig, userStoragePath: string, log: Logging) {
        this.config = config;
        this.userStoragePath = userStoragePath;
        this.log = log;

        setTimeout(async () => {
            await this.init();
        })
    }

    public async uploadImage(imagePath: string, imageName: string, description: string): Promise<string> {
        if (!this.initPerformed) {
            this.logDebug('Google Photos logic could not start or is still starting...');
            return null;
        }

        try {
            const photos = new Photos(await this.authenticate());
            const response = await photos.mediaItems.upload(this.gPhotosPersistData.albumId, imageName, imagePath, description);
            return response.newMediaItemResults[0].mediaItem.productUrl;

        } catch (error) {
            this.logDebug('Uploading to Google Photos failed');
            this.logDebug(error);
            throw new Error('Cannot upload image to Google Photos!');
        }
    }

    private async init(): Promise<void> {
        try {
            this.gPhotosPersistData = await this.readConfig();
        } catch (error) {
            this.gPhotosPersistData = {
                auth_refresh_token: null,
                albumId: null
            };

            this.logDebug('Google photos persisted data cannot be read/parsed, initial setup!');
            this.logDebug(error);
        }
        this.logDebug(this.gPhotosPersistData);

        if (!this.config || !this.config.auth_clientId || !this.config.auth_clientSecret || !this.config.auth_redirectUrl) {
            this.logDebug('Google photos config not correct/incomplete! Disabling functionality!');
            return;
        }

        this.oauth2Client = new google.auth.OAuth2(
            this.config.auth_clientId,
            this.config.auth_clientSecret,
            this.config.auth_redirectUrl
        );

        const photos = new Photos(await this.authenticate());
        try {
            if (!this.gPhotosPersistData.albumId) {
                this.logDebug('Creating Google Photos album');
                const response = await photos.albums.create('Homebridge-Unifi-Protect-Motion-Captures');
                this.gPhotosPersistData.albumId = response.id;
            } else {
                this.logDebug('Google Photos album already created');
            }
            await this.writeConfig(this.gPhotosPersistData);
            this.initPerformed = true;
        } catch (error) {
            this.logDebug('Could not create album');
            this.logDebug(error);
        }
    }

    private async authenticate(): Promise<string> {
        if (!this.gPhotosPersistData.auth_refresh_token) {
            //Open this url and follow the instructions!
            const url = this.oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: [Photos.Scopes.READ_AND_APPEND]
            });
            this.log.info('Please log in on Google Photos to allow for uploading: ' + url);
        } else {
            this.oauth2Client.setCredentials({
                refresh_token: this.gPhotosPersistData.auth_refresh_token
            });
        }

        let accessToken = null;
        try {
            //TODO: only refresh if token is about to expire!
            if (this.gPhotosPersistData.auth_refresh_token) {
                this.logDebug('Refreshing access token');
                accessToken = (await this.oauth2Client.getAccessToken()).token;
            } else {
                this.logDebug('Fetching new access token');
                const {tokens} = await this.oauth2Client.getToken(await this.getAuthCodeFromOauth2callback());
                this.oauth2Client.setCredentials(tokens);
                if (tokens.refresh_token) {
                    this.gPhotosPersistData.auth_refresh_token = tokens.refresh_token;
                }
                this.logDebug(tokens);
                accessToken = tokens.access_token;
            }

            return accessToken;
        } catch (error) {
            this.logDebug('Failed to get auth!');
            this.logDebug(error);
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

    private async readConfig(): Promise<GooglePhotosPersistData> {
        return JSON.parse(await readFileAsync(this.userStoragePath + '/unifi-protect-google-settings.json'));
    }

    private async writeConfig(config: GooglePhotosPersistData): Promise<void> {
        return writeFileAsync(this.userStoragePath + '/unifi-protect-google-settings.json', JSON.stringify(config, null, 4));
    }
}

export interface GooglePhotosConfig {
    upload_gphotos: boolean;
    auth_clientId: string;
    auth_clientSecret: string;
    auth_redirectUrl: string;
}

export interface GooglePhotosPersistData {
    auth_refresh_token: string;
    albumId: string;
}