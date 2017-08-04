'use strict';

const Docker = require('dockerode');
const Config = require('./config');

function pushArray(source, array, prefix) {
    for(let i=0; i<array.length; i++) {
        pushString(source, array[i], prefix);
    }
}

function pushString(source, str, prefix) {
    if (str.toString().trim() !== "") {
        let parts = str.toString().match(/"[^"]+"\b|\S+/g);
        if (parts.length === 1) {
            if (prefix) {
                source.push(prefix);
            }
            source.push(parts[0]);
        } else {
            pushArray(source, parts);
        }
    }
}

function pushStringCond(source, cond, str, prefix) {
    if (cond) {
        pushString(source, str, prefix);
    }
}

function pushLinkContainer(source) {

    const shell = require('shelljs');
    let result = shell.exec("docker ps", {silent: true}).split('\n');

    let iName = result[0].indexOf('NAMES');

    for (let i=1; i<result.length; i++) {
        if (iName > result[i].length) {
            continue;
        }
        pushString(source, "--link " + result[i].substring(iName).trim() + ":" + result[i].substring(iName).trim());
    }
}



class DockerRunWrapper {

    constructor() {
        this.ports = [];
        this.volumes = [];
        this.environment = [];
        this.detached = false;
        this.params = [];
        this.cmdParam = [];
        this.image = "";
        this.it = false;
        this.remove = false;
        this.name = "rename-container";

        let configGlobal = new Config(null, '/tmp');
        this.connection = configGlobal.get('docker-host');
    };

    host(hostName) {
        if (!hostName) {
            return this.connection;
        }
        this.connection = hostName;
        return this;
    };

    port(host, container) {
        if (!host) {
            return this.ports;
        }
        this.ports.push(host + ":" + container);
        return this;
    };

    volume(host, container) {
        if (!host) {
            return this.volumes;
        }
        this.volumes.push(host + ':' + container);
        return this;
    };

    env(variable, value) {
        if (!variable) {
            return this.environment;
        }
        this.environment.push(variable + "=" + value);
        return this;
    };

    dockerParam(param) {
        if (!param) {
            return this.params;
        }
        this.params.push(param);
        return this;
    };

    isDetached(value) {
        if (this.it) {
            throw new Error('Cannot add -d parameter if -it or --rm is set');
        }
        if (value === undefined) {
            return this.detached;
        }
        this.detached = value;
        return this;
    };

    isInteractive(value) {
        if (this.detached) {
            throw new Error('Cannot add -it parameter if daemon is set');
        }
        if (value === undefined) {
            return this.it;
        }
        this.it = value;
        return this;
    };

    isRemove(value) {
        if (value === undefined) {
            return this.remove;
        }
        this.remove = value;
        return this;
    };

    containerName(value) {
        if (value === undefined) {
            return this.name;
        }
        this.name = value;
        return this;
    };

    imageName(value) {
        if (value === undefined) {
            return this.image;
        }
        this.image = value;
        return this;
    };

    commandParam(param) {
        if (param === undefined) {
            return this.cmdParam;
        }
        this.cmdParam.push(param.toString());
        return this;
    };

    buildConsole(addLinks) {

        if (this.image === "") {
            throw new Error('Image cannot be empty');
        }

        let dockerCmd = [];

        pushString(dockerCmd,'-H ' + (!this.connection.match(/^(http|unix)/) ? 'unix://' : '') + this.connection);
        pushString(dockerCmd, 'run');
        pushString(dockerCmd, '--name ' + this.name);
        pushStringCond(dockerCmd, this.it, '-it');
        pushStringCond(dockerCmd, this.remove, '--rm');

        if (addLinks === true) {
            pushLinkContainer(dockerCmd);
        }

        pushArray(dockerCmd, this.params);
        pushArray(dockerCmd, this.environment, '-e');
        pushArray(dockerCmd, this.ports, '-p');
        pushArray(dockerCmd, this.volumes, '-v');

        pushStringCond(dockerCmd, this.detached, '-d');

        pushString(dockerCmd, this.image);
        pushArray(dockerCmd, this.cmdParam);

        return dockerCmd;
    };

    buildApi() {

        let dockerOptions = {};

        dockerOptions.name = this.name;
        dockerOptions.AttachStdin = this.it;
        dockerOptions.AttachStdout = true;
        dockerOptions.AttachErr = true;
        dockerOptions.Env = this.environment;
        dockerOptions.HostConfig = {};
        dockerOptions.HostConfig.AutoRemove = this.remove;
        dockerOptions.HostConfig.Binds = this.volumes;
        dockerOptions.HostConfig.PortBindings = {};
        for(let i=0; i<this.ports.length; i++) {
            let ports = this.ports[i].split(':');
            dockerOptions.HostConfig.PortBindings[ports[1] + "/tcp"] = [ { "HostPort": ports[0].toString() } ];
        }

        dockerOptions.Tty = !this.detached;
        dockerOptions.OpenStdin = !this.detached;
        dockerOptions.StdinOnce = false;
        dockerOptions.Dns = ['8.8.8.8', '8.8.4.4'];

        dockerOptions.Image = this.image;
        dockerOptions.Cmd = this.cmdParam;

        return dockerOptions;

    }

    runConsole() {
        let dockerParams = this.buildConsole(true);

        const spawn = require('child_process').spawnSync;

        let options = {};
        if (this.it) {
            options = {stdio: 'inherit'};
        }

        // const shell = require('shelljs');
        // shell.exec('docker ' + dockerParams.join(' '));

        let docker = spawn('docker', dockerParams, options);

        if (!this.it) {
            console.log(docker.stdout.toString());

            if (docker.status > 0) {
                console.log(docker.stderr.toString());
            }
        } else {
            if (docker.status > 0) {
                console.log('The command causes an unexpected error:');
                console.log('docker ' + dockerParams.join(' '))
            }
        }
    };

    runApi() {

        var opts = {};
        if (this.connection.startsWith('http')) {
            var parts = this.connection.match(/^(https?):\/\/(.*?):(\d+)/);
            opts.protocol = parts[1];
            opts.host = parts[2];
            opts.port = parts[3];
        } else {
            opts.socketPath = this.connection;
        }

        var docker = new Docker(opts);
        var optsc = this.buildApi();

        var previousKey,
            CTRL_P = '\u0010',
            CTRL_Q = '\u0011';

        function handler(err, container) {
            if (err) {
                console.log(err.message);
                return;
            }

            var attach_opts = {stream: true, stdin: true, stdout: true, stderr: true};

            container.attach(attach_opts, function handler(err, stream) {
                // Show outputs
                stream.pipe(process.stdout);

                // Connect stdin
                var isRaw = process.isRaw;
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                process.stdin.setRawMode(true);
                process.stdin.pipe(stream);

                process.stdin.on('data', function(key) {
                    // Detects it is detaching a running container
                    if (previousKey === CTRL_P && key === CTRL_Q) exit(stream, isRaw);
                    previousKey = key;
                });

                container.start(function(err, data) {
                    resize(container);
                    process.stdout.on('resize', function() {
                        resize(container);
                    });

                    container.wait(function(err, data) {
                        exit(stream, isRaw);
                    });

                    if (!optsc.AttachStdin) {
                        exit(stream, isRaw);
                    }
                });
            });
        }

        // Resize tty
        function resize (container) {
            var dimensions = {
                h: process.stdout.rows,
                w: process.stderr.columns
            };

            if (dimensions.h != 0 && dimensions.w != 0) {
                container.resize(dimensions, function() {});
            }
        }

        // Exit container
        function exit (stream, isRaw) {
            process.stdout.removeListener('resize', resize);
            process.stdin.removeAllListeners();
            process.stdin.setRawMode(isRaw);
            process.stdin.resume();
            stream.end();
            process.exit();
        }

        docker.createContainer(optsc, handler);
    }
}


module.exports = DockerRunWrapper;
