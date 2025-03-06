import child_process from 'child_process';

const exec = child_process.exec;

console.log('homebridge-unifi-protect-camera-motion post install script running on: ' + process.arch);

const installProcess = exec('python3 -m venv python-env/venv && python-env/venv/bin/pip install -r requirements.txt');

installProcess.stdout.pipe(process.stdout);
installProcess.stderr.pipe(process.stderr);
installProcess.on('exit', (code) => {
    console.log(code.toString());
});
