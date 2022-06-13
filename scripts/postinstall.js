const fs = require('fs');
const exec = require('child_process').exec;

console.log('homebridge-unifi-protect-camera-motion post install script running on: ' + process.arch);
switch (process.arch) {
    case 'arm':
        console.log('Supported architecture, tfjs-lib should be available!');
        console.log('Specific ARM version: ' + process.config.variables.arm_version);

        // console.log('ARM architecture, tfjs-lib not precompiled, specifying external precompiled lib...');
        // createCustomBinaryJson('https://s3.us.cloud-object-storage.appdomain.cloud/tfjs-cos/libtensorflow-cpu-linux-arm-1.15.0.tar.gz');
        break;
    case 'arm64':
        console.log('Supported architecture, tfjs-lib should be available!');
        console.log('Specific ARM version: ' + process.config.variables.arm_version);

        // console.log('ARM64 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
        // createCustomBinaryJson('https://s3.us.cloud-object-storage.appdomain.cloud/tfjs-cos/libtensorflow-gpu-linux-arm64-1.15.0.tar.gz');
        break;
    case 'cpu-darwin-arm64':
        console.log('Supported architecture, tfjs-lib should be available!');
        console.log('Specific ARM version: ' + process.config.variables.arm_version);
        break;
    case 'cpu-linux-arm64':
        console.log('Supported architecture, tfjs-lib should be available!');
        console.log('Specific ARM version: ' + process.config.variables.arm_version);
        break;
    case 'x32':
    case 'x64':
        console.log('Supported architecture, tfjs-lib should be available!');
        break;
    default:
        console.error('Unsupported processor architecture: ' + process.arch);
}

// TFJS seems to again provide prebuilt binaries for ARM (Raspberry Pi/...), so this is unused for the time being!
function createCustomBinaryJson(packageUrl) {
    const content = {
        "tf-lib": packageUrl
    };

    let tfjsNodeFolder = process.cwd() + '/node_modules/@tensorflow/tfjs-node/';
    let tfjsNodeFolderFound = fs.existsSync(tfjsNodeFolder);
    if (!tfjsNodeFolderFound) {
        console.log('Using fallback location for tfjs-node');
        // Move up in the folder tree two levels.
        tfjsNodeFolder = tfjsNodeFolder.replace('homebridge-unifi-protect-camera-motion/node_modules/', '')
        tfjsNodeFolderFound = fs.existsSync(tfjsNodeFolder);
    }

    if (tfjsNodeFolderFound) {
        console.log('Writing custom binary definition in: ' +  tfjsNodeFolder + 'scripts/');
        fs.writeFileSync(tfjsNodeFolder + 'scripts/custom-binary.json', JSON.stringify(content, null, 4));

        console.log('Running install for tfjs-node again with custom binary specified');
        const installProcess = exec('npm install --unsafe-perm=true', {cwd: tfjsNodeFolder});

        installProcess.stdout.pipe(process.stdout);
        installProcess.stderr.pipe(process.stderr);
        installProcess.on('exit', (code) => {
            console.log('npm install for tfjs-node exited with code ' + code.toString());
        });
    } else {
        console.log('Folder does not exist: ' + tfjsNodeFolder);
    }
}
