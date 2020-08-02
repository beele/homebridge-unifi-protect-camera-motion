const fs = require('fs');
const exec = require('child_process').exec;

console.log('homebridge-unifi-protect-camera-motion postinstall script running on: ' + process.arch);
switch (process.arch) {
    case 'arm':
        console.log('ARM architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
        console.log('Specific ARM version: ' + process.config.variables.arm_version);

        createCustomBinaryJson('https://s3.us.cloud-object-storage.appdomain.cloud/tfjs-cos/libtensorflow-cpu-linux-arm-1.15.0.tar.gz');
        break;
    case 'arm64':
        console.log('ARM64 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');

        createCustomBinaryJson('https://s3.us.cloud-object-storage.appdomain.cloud/tfjs-cos/libtensorflow-gpu-linux-arm64-1.15.0.tar.gz');
        break;
    case 'x32':
    case 'x64':
        console.log('Supported architecture, tfjs-lib should be available!');
        break;
    default:
        console.error('Unsupported processor architecture: ' + process.arch);
}

function createCustomBinaryJson(packageUrl) {
    const content = {
        "tf-lib": packageUrl
    };

    console.log('Writing custom binary definition in: ' +  process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/');

    if (fs.existsSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/')) {
        fs.writeFileSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/custom-binary.json', JSON.stringify(content, null, 4));

        exec('npm install', {cwd: process.cwd() + '/node_modules/@tensorflow/tfjs-node/'}, (error, stdout, stderr) => {
            if (error) {
                console.log(error);
                return;
            }
            console.log(stdout);
            console.error(stderr);
        });
    }
}