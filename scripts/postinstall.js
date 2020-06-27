const fs = require('fs');
const exec = require('child_process').exec;

console.error('homebridge-unifi-protect-camera-motion postinstall script running on: ' + process.arch);
switch (process.arch) {
    case 'arm':
        if (process.config.variables.arm_version && process.config.variables.arm_version === '6') {
            console.log('ARM V6 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
            downloadTensorFlowForArm('https://github.com/beele/homebridge-unifi-protect-camera-motion/raw/feature/feature/rework-camera-and-tfjs/master/resources/tfjs-arm/libtensorflow-2.2.0.armv6l.tar.gz?raw=true');
        } else {
            console.log('ARM V7 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
            downloadTensorFlowForArm('https://github.com/beele/homebridge-unifi-protect-camera-motion/raw/feature/feature/rework-camera-and-tfjs/resources/tfjs-arm/libtensorflow-2.2.0.armv7l.tar.gz?raw=true');
        }
        break;
    case 'arm64':
        console.log('ARM64 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
        downloadTensorFlowForArm('https://github.com/beele/homebridge-unifi-protect-camera-motion/raw/feature/feature/rework-camera-and-tfjs/resources/tfjs-arm/libtensorflow-2.1.0.aarch64.tar.gz?raw=true');
        break;
    case 'x32':
    case 'x64':
        console.log('Supported architecture, tfjs-lib should be available!');
        break;
    default:
        console.error('Unsupported processor architecture: ' + process.arch);
}
rebuildBindings();

function downloadTensorFlowForArm(packageUrl) {
    const content = {
        "tf-lib": packageUrl
    };

    if (fs.existsSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/')) {
        fs.writeFileSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/custom-binary.json', JSON.stringify(content, null, 4));

        exec('npm install', {cwd: process.cwd() + '/node_modules/@tensorflow/tfjs-node/'}, (error, stdout, stderr) => {
            console.log(stdout);
            console.error(stderr);
        });
    }
}

function rebuildBindings() {
    console.log('Rebuilding node bindings...');

    exec('npm rebuild @tensorflow/tfjs-node --build-from-source', {cwd: process.cwd()}, (error, stdout, stderr) => {
        console.log(stdout);
        console.error(stderr);
    });
}