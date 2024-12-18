import {IncomingMessage, ServerResponse} from "http";
import {google} from "googleapis";
import {OAuth2Client} from 'google-auth-library';
import {Logging} from "homebridge";

import http from 'http';
import fs from 'fs';
import {promisify} from 'util';

//@ts-ignore
import Photos from 'googlephotos';

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

export class GooglePhotos {

    private readonly log: Logging;
    private readonly config: GooglePhotosConfig;
    private readonly userStoragePath: string;

    private oauth2Client: OAuth2Client | undefined;
    private gPhotosPersistData: GooglePhotosPersistData | undefined;

    private initPerformed: boolean = false;

    constructor(config: GooglePhotosConfig, userStoragePath: string, log: Logging) {
        this.config = config;
        this.userStoragePath = userStoragePath;
        this.log = log;
    }

    public uploadImage = async (imagePath: string, imageName: string, description: string): Promise<string> => {
        if (!this.initPerformed) {
            this.log.debug('Google Photos logic is still starting...');
            await this.init();
        }

        if (!this.oauth2Client) {
            throw new Error('Google photos oauth2Client missing, init must have failed!');
        }
        if (!this.gPhotosPersistData) {
            throw new Error('Google photos persistent data missing, init must have failed!');
        }

        try {
            const photos = new Photos(await this.authenticate(this.oauth2Client, this.gPhotosPersistData));
            const response = await photos.mediaItems.upload(this.gPhotosPersistData.albumId, imageName, imagePath, description);
            return response.newMediaItemResults[0].mediaItem.productUrl;

        } catch (error) {
            this.log.warn('Uploading to Google Photos failed');
            this.log.debug(JSON.stringify(error, null, 4));
            throw new Error('Cannot upload image to Google Photos!');
        }
    }

    private init = async (): Promise<void> => {
        this.gPhotosPersistData = {
            auth_refresh_token: undefined,
            albumId: undefined
        };

        try {
            this.gPhotosPersistData = await this.readConfig();
        } catch (error) {
            this.log.info('Google photos persisted data cannot be read/parsed, this might be the initial setup!');
            this.log.debug(JSON.stringify(error, null, 4));
        }

        this.log.debug(JSON.stringify(this.gPhotosPersistData, null, 4));

        if (!this.config || !this.config.auth_clientId || !this.config.auth_clientSecret || !this.config.auth_redirectUrl) {
            this.log.debug('Google photos config not correct/incomplete! Disabling functionality!');
            return;
        }

        this.oauth2Client = new google.auth.OAuth2(
            this.config.auth_clientId,
            this.config.auth_clientSecret,
            this.config.auth_redirectUrl
        );

        try {
            const photos = new Photos(await this.authenticate(this.oauth2Client, this.gPhotosPersistData));

            if (this.gPhotosPersistData.albumId) {
                this.log.debug('Google Photos album already created');
            } else {
                this.log.debug('Creating Google Photos album');

                const response = await photos.albums.create('Homebridge-Unifi-Protect-Motion-Captures');
                this.gPhotosPersistData.albumId = response.id;
            }

            await this.writeConfig(this.gPhotosPersistData);
            this.initPerformed = true;

        } catch (error) {
            this.log.warn('Could not create album!');
            this.log.debug(JSON.stringify(error, null, 4));
        }
    }

    private authenticate = async (oauth2Client: OAuth2Client, gPhotosPersistData: GooglePhotosPersistData): Promise<string> => {

        if (gPhotosPersistData.auth_refresh_token) {
            oauth2Client.setCredentials({refresh_token: gPhotosPersistData.auth_refresh_token});
        } else {
             //Open this url and follow the instructions!
             const url = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: [Photos.Scopes.READ_AND_APPEND]
            });
            this.log.info('Please log in on Google Photos to allow for uploading: ' + url);
        }

        let accessToken = null;
        try {
            if (gPhotosPersistData.auth_refresh_token) {
                this.log.debug('Refreshing access token');

                accessToken = (await oauth2Client.getAccessToken()).token;

            } else {
                this.log.debug('Fetching new access token');

                const {tokens} = await oauth2Client.getToken(await this.getAuthCodeFromOauth2callback());
                oauth2Client.setCredentials(tokens);

                if (tokens.refresh_token) {
                    gPhotosPersistData.auth_refresh_token = tokens.refresh_token;
                }
                accessToken = tokens.access_token;

                //this.log.debug(JSON.stringify(tokens, null, 4));
            }

            if (accessToken === null || accessToken === undefined) {
                throw new Error('Could not get access token for Google Photos API!');
            }
            return accessToken;

        } catch (error) {
            this.log.warn('Could not get access token for Google Photos API!');
            this.log.debug(JSON.stringify(error, null, 4));

            throw error;
        }
    }

    private getAuthCodeFromOauth2callback = (): Promise<string> => {
        return new Promise((res, rej) => {
            const requestHandler = (request: IncomingMessage, response: ServerResponse) => {
                response.statusCode = 200;
                response.setHeader('Content-Type', 'text/plain');

                const url = new URL('http://localhost' + request.url);

                if (url.pathname !== '/oauth2-callback') {
                    response.end('OAuth2 callback handler running...');
                    return;
                }

                response.end('OAuth2 callback handled!');
                server.close();

                const code = url.searchParams.get('code');
                if (!code) {
                    this.log.warn('Invalid oauth code, please try again!');
                    return;
                }

                res(code);
            };

            const server = http.createServer(requestHandler).listen(8888);
        });
    }

    private readConfig = async (): Promise<GooglePhotosPersistData> =>{
        return JSON.parse((await readFileAsync(this.userStoragePath + '/unifi-protect-google-settings.json')).toString());
    }

    private writeConfig = async (config: GooglePhotosPersistData): Promise<void> => {
        return await writeFileAsync(this.userStoragePath + '/unifi-protect-google-settings.json', JSON.stringify(config, null, 4));
    }
}

export type GooglePhotosConfig = {
    auth_clientId: string;
    auth_clientSecret: string;
    auth_redirectUrl: string;
}

export type GooglePhotosPersistData = {
    auth_refresh_token: string | undefined;
    albumId: string | undefined;
}
