#!/bin/bash

# install build tools
sudo apt-get install git pkg-config autoconf automake libtool libx264-dev

# (optional) if you need alsa support you will need the ALSA runtime library
sudo apt-get install libasound2-dev

# download and build fdk-aac
git clone https://github.com/mstorsjo/fdk-aac.git
cd fdk-aac
./autogen.sh
./configure --prefix=/usr/local --enable-shared --enable-static
make -j4
sudo make install
sudo ldconfig
cd ..

# download and build ffmpeg
git clone https://github.com/FFmpeg/FFmpeg.git
cd FFmpeg
./configure --prefix=/usr/local --arch=armel --target-os=linux --enable-omx-rpi --enable-nonfree --enable-gpl --enable-libfdk-aac --enable-mmal --enable-libx264 --enable-decoder=h264 --enable-network --enable-protocol=tcp --enable-demuxer=rtsp
make -j4
sudo make install

cd ..
rm -rf FFmpeg
rm -rf fdk-aac
