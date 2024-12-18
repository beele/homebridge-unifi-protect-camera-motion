import child_process from 'child_process';

const exec = child_process.exec;

console.log('homebridge-unifi-protect-camera-motion post install script running on: ' + process.arch);

const installProcess = exec('pip3 install -r requirements.txt');

installProcess.stdout.pipe(process.stdout);
installProcess.stderr.pipe(process.stderr);
installProcess.on('exit', (code) => {
    console.log(code.toString());
});
