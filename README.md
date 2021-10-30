# Unifi-Protect-Camera-Motion [![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) 

[![Build Status](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion.svg?branch=master)](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion)
[![npm](https://badge.fury.io/js/homebridge-unifi-protect-camera-motion.svg)](https://www.npmjs.com/package/homebridge-unifi-protect-camera-motion)
[![donate](https://img.shields.io/badge/donate-paypal-green)](https://paypal.me/MrBeele?locale.x=nl_NL)
  
This Homebridge plugin allows you to add your Unifi Protect Cameras (and their Motion Sensors) to Homekit.
It adds smart detection by using a machine learning model to detect specific classes of objects in the camera view.

# How it Works
This plugin will automatically discover all the Unifi cameras from your Protect installation, and provide the following sensors for each one it finds:

* Camera, for viewing live RTSP streams
* Motion sensor, for sending push-notifications when motion or one of the desired objects have been detected
* A Switch, for easily enabling and disabling motion detection (on by default and after a Homebridge restart)
* A Switch, to trigger a motion event manually, forcing a rich notification
* (if enabled) A switch, that acts as a doorbell trigger, to manually trigger a rich doorbell notification

# Motion Events and object detection
The plugin uses the Unifi Protect API to get motion events on a per camera basis.
When motion has been detected one of the two methods below will be used to generate a motion notification in Homekit:  
- The basic method: The "score" of the Unifi Protect motion event. (Which currently has a bug and is 0 as long as the motion is ongoing.)
- The advanced method: Object detection by use of a Tensorflow model. (recommended)
  This logic/model runs on-device, and no data will be sent to any online/external/cloud source or service. 
  It is based on the [coco ssd](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) project.
  
# Installation:  
Before installing this plugin, please make sure all the prerequisites have been met first.
Consult the readme and [the wiki](https://github.com/beele/homebridge-unifi-protect-camera-motion/wiki) before proceeding.

In short, the main dependencies are:
- Raspberry Pi / Ubuntu / Debian Linux:
  - install: `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
  - I do not support Hoobs as they do funky things, just use the official Homebridge image!
- Mac OS: 
  - install via Homebrew: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`   
- Linux:
  - install g++: `sudo apt install g++`
- Other OSes:
  - [See the node-canvas documentation](https://github.com/Automattic/node-canvas#compiling)
  - [See the node-gyp documentation](https://github.com/nodejs/node-gyp) => install any dependencies for your OS!
  
Next, to install this plugin simply type:

```
sudo npm install homebridge-unifi-protect-camera-motion -g --unsafe-perm=true
```
  
Next, open the `config.json` that contains your Homebridge configuration, and add a block like the following one to the `platforms` array:
  
```javascript  
{  
    "platform": "UnifiProtectMotion", 
    "name": "Unifi protect cameras & motion sensors", 
    "unifi": { 
        "controller": "https://protect-ip:controller-ui-port", 
        "controller_rtsp": "rtsp://protect-ip:controller-rtsp-port", 
        "username": "username", 
        "password": "password", 
        "excluded_cameras": [
            "id-of-camera-to-exclude-1",
            "id-of-camera-to-exclude-2"
        ],
        "motion_interval": 5000, 
        "motion_repeat_interval": 30000, 
        "motion_score": 0, 
        "enhanced_motion": true, 
        "enhanced_motion_score": 50, 
        "enhanced_classes": ["person"], 
        "enable_motion_trigger": true,
        "enable_doorbell_for": [
            "id-of-camera-to-act-as-doorbell-1",
            "id-of-camera-to-act-as-doorbell-1"
        ],
        "save_snapshot": true,
        "debug": false, 
        "debug_network_traffic": false,
    },
    "upload_gphotos": false,
    "googlePhotos": {
        "auth_clientId": "CLIENT-ID",
        "auth_clientSecret": "CLIENT-SECRET",
        "auth_redirectUrl": "http://localhost:8888/oauth2-callback"
    },
    "mqtt_enabled": false,
    "mqtt": {
        "broker": "mqtt://broker-ip",
        "username": "MQTT-BROKER-USERNAME",
        "password": "MQTT-BROKER-PASSWORD",
        "topicPrefix": "motion/cameras"
    }
}  
```  

You can verify the correctness of your config file by using [jsonlint](https://jsonlint.com/).   
The config must be valid or Homebridge will fail to restart correctly.
If you are using Homebridge Config X, it will do its best to alert you to any syntax errors it finds.

## General configuration fields:  

|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|platform|string|yes|/|UnifiProtectMotion|
|name|string|yes|/|Name of the plugin that shows up in the Homebridge logs|
|[unifi](https://github.com/beele/homebridge-unifi-protect-camera-motion#unifi-configuration-fields)|object|yes|/|Wrapper object containing the unifi configuration|
|[upload_gphotos](https://github.com/beele/homebridge-unifi-protect-camera-motion#google-photos-configuration)|boolean|no|false|Contains a boolean indicating whether or not to upload each detection to a google photos album. When using enhanced mode the image is annotated with the class/score that was detected.|
|[mqtt_enabled](https://github.com/beele/homebridge-unifi-protect-camera-motion#mqtt-configuration)|boolean|no|false|Set this to true to enable MQTT support. Additional configuration required!|
|videoProcessor|string|no|ffmpeg|Contains the path to an custom FFmpeg binary|


### Unifi configuration fields:
|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|controller|string|yes|/|Contains the URL to the CloudKey or UDM with UnifiOS, or as legacy the URL to the Unifi Protect web UI, including port (no / or  /protect/ at the end!)|
|controller_rtsp|string|yes|/|Contains the base URL to be used for playing back the RTSP streams, as seen in the RTSP configuration (no / at the end)|
|username|string|yes|/|Contains the username that is used to login in the web UI|
|password|string|yes|/|Contains the password that is used to login in the web UI|
|excluded_cameras|no|string[]|[]|An array that contains the IDs of the cameras which should be excluded from the enumeration in Homekit, all available IDs are printed during startup|
|motion_interval|number|yes|/|Contains the interval in milliseconds used to check for motion, a good default is 5000 milliseconds|
|motion_repeat_interval|number|no|/|Contains the repeat interval in milliseconds during which new motion events will not be triggered if they belong to the same ongoing motion, a good default is 30000 to 60000 milliseconds. This will prevent a bunch of notifications for events which are longer than the motion_interval! Omit this field to disable this functionality|
|motion_score|number|yes|/|Contains the minimum score in % that a motion event has to have to be processed, a good default is 50%, set this to 0 when using enhanced motion!|
|enhanced_motion|boolean|yes|/|Enables or disables the enhanced motion & object detection detection with Tensorflow|
|enhanced_motion_score|number|sometimes|/|This field is required if the `enhanced_motion` field is set to true and contains the minimum score/certainty in % the enhanced detection should reach before allowing an motion event to be triggered |
|enhanced_classes|string[]|sometimes|[]|This field is required if the `enhanced_motion` field is set to true and contains an array of classes (in lowercase) of objects to dispatch motion events for. The array should not be empty when using the enhanced detection! Look in look in src/coco/classes.ts for all available classes|
|enable_motion_trigger|boolean|no|false|Contains a boolean that when set to true will enable an extra button for each camera to manually trigger a motion notification|
|enable_doorbell_for|string[]|no|[]|Contains the id of the cameras for which the doorbell functionality should be enabled, all available IDs are printed during startup|
|save_snapshot|boolean|no|false|Contains a boolean indicating whether or not to save each detection to a jpg file in the `.homebridge` directory. When using enhanced mode the image is annotated with the class/score that was detected.|
|debug|boolean|no|false|Contains a boolean indicating whether or not to enable debug logging for the plugin and FFmpeg|
|debug_network_traffic|boolean|no|false|Contains a boolean indication whether or not to enable logging of all network requests|

### Google Photos configuration:

|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|auth_clientId|string|sometimes|/|This field is required when the `upload_gphotos` is set to true. Fill in the Client ID you generated for OAuth2 authentication|
|auth_clientSecret|string|sometimes|/|This field is required when the `upload_gphotos` is set to true. Fill in the Client Secret you generated for OAuth2 authentication|
|auth_redirectUrl|string|sometimes|/|Fill in 'http://localhost:8888/oauth2-callback' as a default, if you change this value to something else, also change it when creating the OAuth2 credentials! The port should always be 8888!|

To enable the upload to Google Photos functionality please [read the relevant wiki article](https://github.com/beele/homebridge-unifi-protect-camera-motion/wiki/Google-Photos:-setting-up-automatic-upload)

### MQTT configuration:

|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|broker|string|no|/|This field is required when the enabled field is set to true. Fill in your MQTT broker url, without the port|
|username|string|no|/|This field contains the username for the MQTT broker connection, if any|
|password|string|no|/|This field contains the password for the MQTT broker connection, if any|
|topicPrefix|string|no|/|This field contains the optional topic prefix. Each motion event will be dispatched under `topicPrefix/cameraName`|

### Camera configuration:

- Make sure each of your Unifi cameras has at least one RTSP stream enabled.
  However, I suggest enabling all available qualities for the best user experience as the plugin will choose the most appropriate one based on the request coming from Homekit.
  - To enable an RTSP stream: Login on the Protect web UI and go the settings of the camera and open the 'manage' tab   
      Make sure all your cameras have the same port for the RTSP stream!  
      For optimal results it is best to assign a static ip to your cameras  
      ![Enable RTSP stream](resources/images/readme/enable_rtsp.jpg?raw=true "CloudKey Gen2 Plus")  
  
## How to add the cameras to your Homekit setup:  

As per 0.4.1 the enumerated cameras and accompanying switches/triggers will show up automatically, You don't need to add them in manually anymore!
If you add your Homebridge instance to the Home app the cameras will automatically be there.

### Upgrade notice!

If you are upgrading from a pre 0.4.1 the cameras you previously had in the Home app will no longer work and will have to be removed!
Tap on a camera preview to open the camera feed, click the settings icon and scroll all the way to the bottom, there select `Remove camera from home`.
  
## How to enable rich notifications (with image preview):  
  
- Go to the settings of the camera view in the Home app  
- Each camera has an accompanying motion sensor   
- Enable notifications for the camera  
- Whenever motion has been detected you will get a notification from the home app with a snapshot from the camera  
  
## Tested with:  
  
- Raspberry Pi 3B with Node 11.15.0 as Homebridge host  
- Raspberry Pi 4B 4 GiB with Node 12.14.0 as Homebridge host  
- Macbook Pro with Node 12.18.0 as Homebridge host  
- Windows 10 with Node 12.13.0 as Homebridge host
- Ubiquiti UniFi CloudKey Gen2 Plus - Cloud Key with Unifi Protect functionality  
  <br/><br/>![CloudKey Gen2 Plus](resources/images/readme/cloudkey-gen2plus.jpg?raw=true "CloudKey Gen2 Plus")  
- 2x Ubiquiti UniFi Video UVC-G3-AF - PoE Camera  
  <br/><br/>![Camera UVC-G3-AF](resources/images/readme/camera.jpeg?raw=true "Camera UVC-G3-AF")  
- 2x Ubiquiti Unifi Video UVC-G3-Flex - PoE Camera  
  <br/><br/>![Camera UVC-G3-Flex](resources/images/readme/camera2.jpeg?raw=true "Camera UVC-G3-Flex")  
  
## Limitations, known issues & TODOs:  
  
### Limitations:  
 
- Running this plugin on CPUs that do not support AVX (Celerons in NAS systems, ...) is not supported because there are no prebuilt Tensorflow binaries. 
  Compiling Tensorflow from scratch is out of scope for this project!
  - Run it on a Raspberry Pi or machine with macOS / Windows / Linux (Debian based)
- Unifi Protect has a snapshot saved for every event, and there is an API to get these (with Width & Height), but the actual saved image is pretty low res and is scaled up to 1080p. 
  Using the Anonymous snapshot actually gets a full resolution snapshot which is better for object detection.  
- There is no way to know what motion zone (from Unifi) a motion has occurred in. 
  This information is not present is the response from their API.  
- The enhanced object detection using CoCo is not perfect and might not catch all the thing you want it to.
  It should do fine in about 95% of cases though.
  
### TODOs:  

- Add more unit and integration tests (Ongoing)
- Add support for MQTT (Ongoing)
- ~~Upgrade tfjs-node, now held back because newer versions (Upgrade to 2.x.x in future release)~~ (Done)
- ~~Implement required changes to make this work with Unifi OS~~
- ~~Figure out how to get higher res streams on iPhone (only iPad seems to request 720p streams)~~ (Done)
- ~~Extend documentation & wiki~~ (Done)
- ~~Add support for two-way audio~~ (Done)
  
# Plugin development  

- Checkout the git repo  
- Run `npm install` in the project root folder
- Create a dummy config.json file under `resources/test-config/`  
- use `npm run watch` to automatically watch for changes and restart Homebridge if needed, you can also add a remote debugger on port 4444 to debug the code.
- use `npm run homebridge` to start a Homebridge instance that points to the local config that does not auto-reload when changes are saved.

# Credits

A big thanks to the developers of [Homebridge Camera FFmpeg](https://github.com/Sunoo/homebridge-camera-ffmpeg) and [Homebridge-unifi-protect](https://github.com/hjdhjd/homebridge-unifi-protect) for their contributions and valuable insights in how to get things working!

# Disclaimer  
  
This plugin is provided free of charge and without any warranty of its functionality.  
The creator cannot be held responsible for any damages, missed motion notifications that cause damage or harm.
