# Unifi-Protect-Camera-Motion [![Build Status](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion.svg?branch=master)](https://travis-ci.com/beele/homebridge-unifi-protect-camera-motion)  
  
This Homebridge plugin extends the standard [FFmpeg Homebridge plugin](https://github.com/KhaosT/homebridge-camera-ffmpeg#readme) and provides your cameras and motion sensors for use in Homekit.  
  
This plugin will enumerate all the cameras in your protect account and provide both a camera and a motion sensor in Homekit for each camera in protect.  
  
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
    "platform": "Unifi-Protect-Camera-Motion", 
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
        "save_snapshot": true 
    }, 
    driveUpload: false, 
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
|platform|string|yes|/|Unifi-Protect-Camera-Motion|
|name|string|yes|/|Name of the plugin that shows up in the Homebridge logs|
|[unifi](https://github.com/beele/homebridge-unifi-protect-camera-motion#unifi-config-fields)|object|yes|/|Wrapper object containing the unifi configuration|
|driveUpload|boolean|no|false|Indicates whether or not to upload the motion snapshots to Google Drive. This requires the [drive integration]()https://github.com/KhaosT/homebridge-camera-ffmpeg/wiki/Uploading-Snapshots-to-Google to be set up!  |
|[videoConfig](https://github.com/beele/homebridge-unifi-protect-camera-motion#unifi-config-fields)|object|yes|/|Wrapper object containing the video configuration for FFmpeg|


### Unifi config fields:
|Field|Type|Required|Default value|Description|
|-----|----|--------|-------------|-----------|
|controller|string|yes|/|Contains the url to the Unifi protect web interface  |
|controller_rtsp|string|yes|/|Contains the base url to be used for playing back the RTSP streams|
|username|string|yes|/|Contains the username that is used to login in the web UI|
|password|string|yes|/|Contains the password that is used to login in the web UI|
|motion_interval|number|yes|/|Contains the interval in milliseconds used to check for motion, a good default is 5000 milliseconds|
|motion_repeat_interval|number|no|/|Contains the repeat interval in milliseconds during which new motion events will not be triggered if they belong to the same ongoing motion, a good default is 30000 to 60000 milliseconds. This will prevent a bunch of notifications for events which are longer than the motion_interval! Omit this field to disable this functionality|
|motion_score|number|yes|/|Contains the minimum score in % that a motion event has to have to be processed, a good default is 50%|
|enhanced_motion|boolean|yes|/|Enables or disables the enhanced motion & object detection detection with Tensorflow|
|enhanced_motion_score|number|sometimes|/|This field is required if the `enhanced_motion` field is set to true and contains the minimum score/certainty in % the enhanced detection should reach before allowing an motion event to be triggered |
|enhanced_classes|string[]|sometimes|[]|This field is required if the `enhanced_motion` field is set to true and contains an array of classes of objects to dispatch motion events for. The array should not be empty when using the enhanced detection! Look in look in src/coco/classes.ts for all available classes|
|debug|boolean|no|false|Contains a boolean indicating whether or not to enable debug logging|
|save_snapshot|boolean|no|false|Contains a boolean indicating whether or not to save each detection to a jpg file in the user's home directory. When using enhanced mode the image is annotated with the class/score that was detected.|

### Video config:

This config object is the same as used in the Homebridge-FFmpeg plugin.
Consult the documentation for more details: [FFmpeg configuration]([https://github.com/KhaosT/homebridge-camera-ffmpeg#homebridge-camera-ffmpeg](https://github.com/KhaosT/homebridge-camera-ffmpeg#homebridge-camera-ffmpeg)). 
- ***Make sure the fields `source` and `stillImageSource` are omitted from the config object as these will be generated by the plugin itself!***
- Make sure that your Unifi camera has anonymous snapshots enabled and that preferably only one RTSP stream is enabled, otherwise it will not work correctly and might not be available in Homekit!  
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
- Macbook Pro with Node 10.16.2 as Homebridge host  
- Ubiquiti UniFi CloudKey Gen2 Plus - Cloud Key with Unifi Protect functionality  
  <br/><br/>![CloudKey Gen2 Plus](resources/images/cloudkey-gen2plus.jpg?raw=true "CloudKey Gen2 Plus")  
- 2x Ubiquiti UniFi Video UVC-G3-AF - PoE Camera  
  <br/><br/>![Camera UVC-G3-AF](resources/images/camera.jpeg?raw=true "Camera UVC-G3-AF")  
- 1x Ubiquiti Unifi Video UVC-G3-Flex - PoE Camera  
  <br/><br/>![Camera UVC-G3-Flex](resources/images/camera2.jpeg?raw=true "Camera UVC-G3-Flex")  
  
## Limitations, known issues & TODOs:  
  
### Limitations:  
  
- Previews in notifications are requested by the Home app, and can thus be 'after the fact' and show an image with nothing of interest on it.  
  - The actual motion detection is done with the snapshot that is requested internally.  
- Unifi Protect has a snapshot saved for every event, and there is an API to get these (with Width & Height) but the actual saved image is pretty low res and is upscaled to 1080p. Using the Anonymous snapshot actually get a full res snapshot (beter of object detection).  
- There is no way to know what motion zone (from Unifi) a motion has occurred in. This information is not present is the response from their API.  
- The enhanced object detection using CoCo is far from perfect and might not catch all the thing you want it to.  
  
### TODOs:  

- Implement required changes to make this work with the UDM Pro  
- Figure out how to get higher res streams on iPhone (only iPad seems to request 720p streams)  
- Add more unit and integration tests  
- Extend documentation & wiki 
  
# Plugin development:  
- Checkout the git repo  
- Install Homebridge (you can use `npm run install-homebridge`)  
- Adjust the dummy config under `resources/test-config/config.json`  
- use `npm run homebridge` to start a Homebridge instance that points to the local config  
  
# Disclaimer  
  
This plugin is provided free of charge and without any warranty of its functionality.  
The creator cannot be held responsible for any damages, missed motion notifications that cause damage or harm.