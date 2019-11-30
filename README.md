# Unifi-Protect-Camera-Motion

This Homebridge plugin extends the standard [FFmpeg Homebridge plugin](https://github.com/KhaosT/homebridge-camera-ffmpeg#readme) and provides your cameras and motion sensors for use in Homekit.

This plugin will enumerate all the cameras in your protect account and provide both a camera and a motion sensor in Homekit for each camera in protect.
Motion events will be triggered either by the motion events from protect itself (when the score is sufficient) or will be processed with Tensorflow for smarter analysis.
The Tensorflow logic/model runs on your device and no data is ever sent to any online source, it is based on [this](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) project.

## To experiment with this plugin:
- Checkout the git repo
- Install Homebridge (you can use `npm run install-homebridge`)
- Adjust the dummy config under `resources/test-config/config.json`
- Swap the commented line in the `setMotionCheckInterval` function to allow for local development & testing
- use `npm run homebridge` to start a homebridge instance that points to the local config

## Installation:
To install this plugin simple type `sudo npm install homebridge-unifi-protect-camera-motion -g --unsafe-perm=true`.

If you have trouble installing make sure you have the required dependencies installed to build node-canvas from source.
This can be done by executing the command for your operating system as listed table under `Compiling` on the [node-canvas github page](https://github.com/Automattic/node-canvas#compiling), further actions are not required.
After this try running the npm install command again.

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
        "enhanced_classes": [
            "Person - or any other COCO classes, look in src/coco/classes.ts"
        ],
        "debug": false,
        "save_snapshot": true
    },
    "videoConfig": {
        "vcodec": "h264 - or h264_omx",
        "audio": false,
        "maxStreams": 2,
        "maxWidth": 1024,
        "maxHeight": 576,
        "maxFPS": 15,
        "mapvideo": "0:1",
        "mapaudio": "0:0"
    }
}
```
Config fields:

- `platform`: This field is required and has to be `Unifi-Protect-Camera-Motion`
- `name`: This field is required and can be set freely
- `unifi`: This object is required and contains the configuration for Unifi
    - `controller`: This field is required and contains the url to the Unifi protect web interface
    - `controller_rtsp`: This field is required and contains the base url to be used for playing back the RTSP streams
    - `username`: This field is required and contains the username that is used to login in the web UI
    - `password`: This field is required and contains the password that is used to login in the web UI
    - `motion_interval`: This field is required and contains the interval used to check for motion, a good default is 5000(ms)
    - `motion_repeat_interval`: This field is optional and contains the repeat interval during which new motion events will not be triggered if they belong to the same ongoing motion, a good default is 30000 to 60000(ms). This will prevent a bunch of notifications for events which are longer then the motion_interval! Omit this field to disable this functionality.
    - `motion_score`: This field is required and contains the minimum score a motion event has to have to be processed, a good default is 50 (%). This is the value that is defined in the Protect interface!
    - `enhanced_motion`: This field is required and enables or disables the enhanced motion & object detection detection with Tensorflow, value should be true or false
    - `enhanced_motion_score`: This field is required if the `enhanced_motion` field is set to true and contains the minimum score/certainty the enhanced detection should reach before allowing an motion event to be triggered
    - `enhanced_classes`: this field is required and contains an array of string describing the classes of objects to dispatch motion events for, can be an empty array when `enhanced_motion` is set to false! 
    - `debug`: This field is optional and contains a boolean indicating whether or not to enable debug logging, defaults to false if omitted.
    - `save_snapshot`: This field is optional and contains a boolean indicating whether or not to save each detection to a jpg file in the user's home directory. When using enhanced mode the image is annotated with the class/score that was detected.
- `videoConfig`: This object is required and contains the general settings for each camera
    - This is the regular videoConfig you would use for the [FFmmpeg plugin](https://github.com/KhaosT/homebridge-camera-ffmpeg#readme), however the fields `source` and `stillImageSource` should be omitted as these will be generated by the plugin itself!
    - See the [FFmpeg readme](homebridge-camera-ffmpeg.md) for more information.
    - Make sure that your Unifi camera has anonymous snapshots enabled and that only one RTSP stream is enabled, otherwise it will not work correctly and might not be available in Homekit!
        - To enable anonymous snapshots: Login on the camera itself (visit its ip address) <br/>
          ![Anonymous snapshot](resources/images/anonymous_snapshot.jpg?raw=true "CloudKey Gen2 Plus")
        - To enable an RTSP stream: Login on the Protect web UI and go the settings of the camera and open the manage tab<br/> 
          Make sure that all your cameras have the same port for the RTSP stream!
          For optimal results it is best to assign a static ip to your cameras
          ![Enable RTSP stream](resources/images/enable_rtsp.jpg?raw=true "CloudKey Gen2 Plus")

### How to add the cameras to your Homekit setup:

- Open the Home app
- Click the (+) icon on the top
- Select 'Add Accessory'
- In the next screen select 'I Don't Have a Code or Cannot Scan'
- Your cameras should show up in the next screen, select one
- Enter the code for your Homebridge in the prompt, the camera will be added
- Repeat for all the cameras you want to add

### How to enable rich notifications (with image preview):

- Go to the settings of the camera view in the Home app
- Each camera has an accompanying motion sensor 
- Enable notifications for the camera
- Whenever motion is detected you will get a notification from the home app with a snapshot from the camera


### For installation on the Raspberry Pi:

- Can be ran on any Raspberry Pi, however when making use of the enhanced motion/object detection feature you should at least use a Raspberry Pi 3 or newer!
    - Make sure that you set the `motion_interval` field to a multiple of 2 seconds per camera, so 5 cameras would mean an interval of at least 10 seconds!
      This is to make sure you do not overload the Raspberry Pi! On the Latest Pi 4 the timings can be lower, experiment with this to find the best timings!
- Make sure you have FFmpeg installed, preferably compiled with OMX support
    - Follow [these](https://github.com/legotheboss/YouTube-files/wiki/(RPi)-Compile-FFmpeg-with-the-OpenMAX-H.264-GPU-acceleration) instructions to compile FFmpeg with the correct options
    - It is possible to use FFmpeg with the OpenMax driver (OMX) but performance will be lower!

### Tested with:

- Raspberry Pi 3B with Node 11.15.0 as Homebridge host
- Macbook Pro with Node 10.16.2 as Homebridge host
- Ubiquiti UniFi CloudKey Gen2 Plus - Cloud Key with Unifi Protect functionality
  <br/><br/>![CloudKey Gen2 Plus](resources/images/cloudkey-gen2plus.jpg?raw=true "CloudKey Gen2 Plus")
- 2x Ubiquiti UniFi Video UVC-G3-AF - PoE Camera
  <br/><br/>![Camera UVC-G3-AF](resources/images/camera.jpeg?raw=true "Camera UVC-G3-AF")

### Limitations, known issues & TODOs:

Limitations:

- Previews in notifications are requested by the Home app, and can thus be 'after the fact' and show an image with nothing of interest on it.
    - The actual motion detection is done with the snapshot that is requested internally.
- There is no way to know what motion zone (from Unifi) a motion has occurred in. This information is not present is the response from their API.
- The enhanced object detection using CoCo is far from perfect and might not catch all the thing you want it to.

TODOs:

- Get sound working in the livestreams.
- Get the livestreams to use a higher quality as right now it will not stream at 720p or higher.

## Disclaimer

This plugin is provided free of charge and without any warranty of its functionality.
The creator cannot be held responsible for any damages, missed motion notifications that cause damage or harm.
