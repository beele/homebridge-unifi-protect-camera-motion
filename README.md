# Unifi-Protect-Camera-Motion [![Build Status](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion.svg?branch=master)](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion)  
  
This Homebridge plugin extends the standard [FFmpeg Homebridge plugin](https://github.com/KhaosT/homebridge-camera-ffmpeg#readme) and provides your cameras and motion sensors for use in Homekit.  
  
This plugin will enumerate all the cameras in your protect account and provide a camera, a motion sensor and switch in Homekit for each camera in protect.
The switch allows you to disable the motion detection (on by default).  
  
Motion events are queried from the Unifi Protect API and used to generate motion events in Homekit.  
There are two methods this plugin can use to generate these events in Homekit:  
- Based on the score of the Unifi Protect motion event  
- Based on the above but with an additional object detection step by use of a Tensorflow model.  
  The Tensorflow logic/model runs on the device itself and no data is ever sent to any online source, it is based on [this](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) project.  
  
# Installation:  
Before installing this plugin make sure are prerequisites are met!   
Consult [the wiki](https://github.com/beele/homebridge-unifi-protect-camera-motion/wiki) before continuing!  
  
To install this plugin simple type `sudo npm install homebridge-unifi-protect-camera-motion -g --unsafe-perm=true`.  
  
Next open the config.json that contains your Homebridge configuration and add a block like the following one to the platforms array:  
  
```javascript  
{  
    "platform": "UnifiProtectMotion", 
    "name": "Unifi protect cameras & motion sensors", 
    "unifi": { 
        "controller": "https://protect-ip:controller-ui-port", 
        "controller_rtsp": "rtsp://protect-ip:controller-rtsp-port", 
        "username": "username", 
        "password": "password", 
        "motion_interval": 5000, 
        "motion_repeat_interval": 30000, 
        "motion_score": 50, 
        "enhanced_motion": true, 
        "enhanced_motion_score": 50, 
        "enhanced_classes": ["Person"], 
        "debug": false, 
        "save_snapshot": true,
        "upload_gphotos": false 
    },
    "videoConfig": { 
        "vcodec": "h264_omx", 
        "audio": true, 
        "maxStreams": 2, 
        "maxWidth": 1024, 
        "maxHeight": 576, 
        "maxFPS": 15, 
        "mapvideo": "0:1", 
        "mapaudio": "0:0", 
        "maxBitrate": 3000, 
        "packetSize": 376, 
        "additionalCommandline": "-protocol_whitelist https,crypto,srtp,rtp,udp" 
    }
}  
```  

## Config fields:  

|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|platform|string|yes|/|UnifiProtectMotion|
|name|string|yes|/|Name of the plugin that shows up in the Homebridge logs|
|[unifi](https://github.com/beele/homebridge-unifi-protect-camera-motion#unifi-config-fields)|object|yes|/|Wrapper object containing the unifi configuration|
|[videoConfig](https://github.com/beele/homebridge-unifi-protect-camera-motion#unifi-config-fields)|object|yes|/|Wrapper object containing the video configuration for FFmpeg|


### Unifi config fields:
|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|controller|string|yes|/|Contains the URL to the CloudKey or UDM with UnifiOS, or as legacy the URL to the Unifi Protect web UI, including port|
|controller_rtsp|string|yes|/|Contains the base URL to be used for playing back the RTSP streams, as seen in the RTSP configuration|
|username|string|yes|/|Contains the username that is used to login in the web UI|
|password|string|yes|/|Contains the password that is used to login in the web UI|
|motion_interval|number|yes|/|Contains the interval in milliseconds used to check for motion, a good default is 5000 milliseconds|
|motion_repeat_interval|number|no|/|Contains the repeat interval in milliseconds during which new motion events will not be triggered if they belong to the same ongoing motion, a good default is 30000 to 60000 milliseconds. This will prevent a bunch of notifications for events which are longer than the motion_interval! Omit this field to disable this functionality|
|motion_score|number|yes|/|Contains the minimum score in % that a motion event has to have to be processed, a good default is 50%|
|enhanced_motion|boolean|yes|/|Enables or disables the enhanced motion & object detection detection with Tensorflow|
|enhanced_motion_score|number|sometimes|/|This field is required if the `enhanced_motion` field is set to true and contains the minimum score/certainty in % the enhanced detection should reach before allowing an motion event to be triggered |
|enhanced_classes|string[]|sometimes|[]|This field is required if the `enhanced_motion` field is set to true and contains an array of classes of objects to dispatch motion events for. The array should not be empty when using the enhanced detection! Look in look in src/coco/classes.ts for all available classes|
|debug|boolean|no|false|Contains a boolean indicating whether or not to enable debug logging for the plugin and FFmpeg|
|save_snapshot|boolean|no|false|Contains a boolean indicating whether or not to save each detection to a jpg file in the user's home directory. When using enhanced mode the image is annotated with the class/score that was detected.|
|upload_gphotos|boolean|no|false|Contains a boolean indicating whether or not to upload each detection to a google photos album. When using enhanced mode the image is annotated with the class/score that was detected.|

### Google Photos config:

***Experimental, this is a work in progress and might not work correctly yet!***

To enable the upload to Google Photos functionality:
- Go to the [Google Cloud Platform developer console](https://console.cloud.google.com/apis/credentials)
- [Create a new project](https://console.cloud.google.com/projectcreate?previousPage=%2Fapis%2Fcredentials)
- You will be redirected to the first page, here select the newly created project from the dropdown on the top left
- Select the 'OAuth consent screen' from the left sidebar menu
- Select 'External' and continue
- On the next screen only fill in a name for the application and click 'save'
- Select the 'Credentials' from the left sidebar menu
- Click 'Create credentials' from the top and select 'OAuth Client ID' from the dropdown options
- Select 'web application', give it a name and fill in the callback URLs with: `http://localhost:8080` for the first and `http://localhost:8080/oauth2-callback` for the second entry (make sure the press return/enter to submit the values, as multiple ones are possible), then click 'create' at the bottom of the page
- Copy your Client ID and Client secret and store them safely
- Open a terminal and go to your `.homebridge` folder
- Create a file named: `unifi-protect-google-settings.json` and open it for editing
- Copy the contents of the `unifi-protect-google-settings.json` under in the 'resources' folder of this project
- Fill in your Client ID and Client secret, leave the other fields as they are
- Start your homebridge instance, it will print out an url, open it in a browser an follow the login instructions
- The page where you will be redirected will display an error unless you are running Homebridge on the same machine as you are running the browser
- Copy the full url, replace the localhost in the address bar with the ip-address of your raspberry pi, visit the page, you should get the following message: 'OAuth2 callback handled!'
- You are now authenticated, and the refresh token has been saved to the previously created config file.
- The plugin will then create an album named 'Homebridge-Unifi-Protect-Motion-Captures', it will also store the ID of this album so the next time it is not created again (you can rename this album to anything you want)
- Any detected motions (both normal and enhanced) will now be uploaded to the previously created album


### Video config:

This config object is the same as used in the Homebridge-FFmpeg plugin.
Consult the documentation for more details: [FFmpeg configuration](https://github.com/KhaosT/homebridge-camera-ffmpeg#readme). 
- ***Make sure the fields `source` and `stillImageSource` are omitted from the config object as these will be generated by the plugin itself!***
- Make sure that your Unifi camera has anonymous snapshots enabled and that preferably only one RTSP stream is enabled, otherwise it might not work correctly!  
  - To enable anonymous snapshots: Login on the camera itself (visit the camera's ip address) <br/>  
      ![Anonymous snapshot](resources/images/anonymous_snapshot.jpg?raw=true "CloudKey Gen2 Plus")  
  - To enable an RTSP stream: Login on the Protect web UI and go the settings of the camera and open the manage tab<br/>   
      Make sure that all your cameras have the same port for the RTSP stream!  
      For optimal results it is best to assign a static ip to your cameras <br/>  
      ![Enable RTSP stream](resources/images/enable_rtsp.jpg?raw=true "CloudKey Gen2 Plus")  
  
## How to add the cameras to your Homekit setup:  

The enumerated cameras (and the motion sensors) will not show up automatically, you need to add them in by yourself:

- Open the Home app  
- Click the (+) icon on the top  
- Select 'Add Accessory'  
- In the next screen select 'I Don't Have a Code or Cannot Scan'  
- Your cameras should show up in the next screen, select one  
- Enter the code for your Homebridge in the prompt, the camera will be added  
- Repeat for all the cameras you want to add  
  
## How to enable rich notifications (with image preview):  
  
- Go to the settings of the camera view in the Home app  
- Each camera has an accompanying motion sensor   
- Enable notifications for the camera  
- Whenever motion is detected you will get a notification from the home app with a snapshot from the camera  
  
## Tested with:  
  
- Raspberry Pi 3B with Node 11.15.0 as Homebridge host  
- Raspberry Pi 4B 4GB with Node 12.14.0 as Homebridge host  
- Macbook Pro with Node 12.13.1 as Homebridge host  
- Ubiquiti UniFi CloudKey Gen2 Plus - Cloud Key with Unifi Protect functionality  
  <br/><br/>![CloudKey Gen2 Plus](resources/images/cloudkey-gen2plus.jpg?raw=true "CloudKey Gen2 Plus")  
- 2x Ubiquiti UniFi Video UVC-G3-AF - PoE Camera  
  <br/><br/>![Camera UVC-G3-AF](resources/images/camera.jpeg?raw=true "Camera UVC-G3-AF")  
- 2x Ubiquiti Unifi Video UVC-G3-Flex - PoE Camera  
  <br/><br/>![Camera UVC-G3-Flex](resources/images/camera2.jpeg?raw=true "Camera UVC-G3-Flex")  
  
## Limitations, known issues & TODOs:  
  
### Limitations:  
  
- Previews in notifications are requested by the Home app, and can thus be 'after the fact' and show an image with nothing of interest on it.  
  - The actual motion detection is done with the snapshot that is requested internally.  
- Unifi Protect has a snapshot saved for every event, and there is an API to get these (with Width & Height) but the actual saved image is pretty low res and is upscaled to 1080p. Using the Anonymous snapshot actually get a full res snapshot (better for object detection).  
- There is no way to know what motion zone (from Unifi) a motion has occurred in. This information is not present is the response from their API.  
- The enhanced object detection using CoCo is far from perfect and might not catch all the thing you want it to.  
  
### TODOs:  

- Implement required changes to make this work with Unifi OS (In progress)  
- Add more unit and integration tests 
- Upgrade tfjs-node, now held back because newer versions [will not install correctly on RBPI](https://github.com/tensorflow/tfjs/issues/3052) 
- ~~Figure out how to get higher res streams on iPhone (only iPad seems to request 720p streams)~~ (Not possible) 
- ~~Extend documentation & wiki~~ (Done)
  
# Plugin development:  
- Checkout the git repo  
- Run `npm install` in the project root folder
- Adjust the dummy config under `resources/test-config/config.json`  
- use `npm run homebridge` to start a Homebridge instance that points to the local config  
  
# Disclaimer  
  
This plugin is provided free of charge and without any warranty of its functionality.  
The creator cannot be held responsible for any damages, missed motion notifications that cause damage or harm.