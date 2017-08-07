'use strict';

const Docker = require('dockerode');
const DockerListWrapper = require('./dockerlistwrapper');
const Config = require('./config');

module.exports = {

    pull(image, callback) {
        let docker = new Docker();

        let instance = docker.getImage(image);
        instance.inspect(function (err, result) {
            if (!err) {
                callback();
                return;
            }

            docker.pull(image, function(err, stream) {
                if (err) {
                    console.log(err.message);
                    return;
                }

                docker.modem.followProgress(stream, onFinished, onProgress);

                function onFinished(err, output) {
                    if (err) {
                        console.log(err.message);
                        return;
                    }
                    callback();
                }

                function onProgress(event) {
                    console.log(event.id + ' ' +event.status + ' ' + event.progress);
                }
            });
        });
    },

    /**
     *
     * @param {DockerRunWrapper} dockerRunWrapper
     */
    up(instance, dockerRunWrapper, callback) {
        let me = this;
        this.pull(dockerRunWrapper.imageName(), function () {
            let list = new DockerListWrapper(dockerRunWrapper.configGlobal);
            list.getRunning(function (data) {
                for (let i=0; i<data.length; i++) {
                    dockerRunWrapper.link(data[i].Names[0], data[i].Names[0])
                }
                me.runUsingApi(dockerRunWrapper);
                callback(null, instance + ' was started');
            });
        });
    },

    down(instance, callback) {
        let docker = new Docker();
        let container = docker.getContainer(instance + '-container');
        container.stop(function (err, data) {
            if (err) {
                callback(err);
                return;
            }
            callback(null, instance + ' was finished');
        });
    },

    outputRaw(option, dockerrunwrapper) {
        if (option === 'api') {
            return dockerrunwrapper.buildApi();
        } else {
            return 'docker ' + dockerrunwrapper.buildConsole().join(' ');
        }
    },

    restart(instance, dockerRunWrapper, callback) {
        var me = this;
        this.down(instance, function (data, dataverb) {
            if (data instanceof Error) {
                callback(null, instance + ' was not started.')
            } else {
                callback(data, dataverb);
            }

            me.up(instance, dockerRunWrapper, callback);
        });
    },

    status(instance, callback) {
        let docker = new Docker();
        let container = docker.getContainer(instance + '-container');

        container.inspect(function(err, data) {
            if (err) {
                if (err.statusCode === 404) {
                    callback(instance + ' is down');
                    return;
                }
            }

            callback(instance + ' is ' + data.State.Status);
        });
    },

    /**
     *
     * @param {ScriptContainer} sc
     * @param {Config} script
     * @param {string} command
     * @param {boolean} setup
     */
    run(sc, script, command, setup, output) {
        if (!sc.existsScript(script)) {
            throw new Error('Script "' + script + '" does not exists');
        }

        if (setup){
            sc.getScript(script)['setup'](function(data, dataverb) {
                output.printErr(data);
                output.print(data, dataverb);
            });
        }

        return sc.getScript(script)[command](function(data, dataverb) {
            output.printErr(data);
            output.print(data, dataverb);
        });
    },

    getConfig(sc, script) {
        this.run(sc, script, 'setup', false);
        return new Config(script, '/tmp/ustemp');
    },

    handleTerminal: function(err, stream, container, hasTerminal) {

        var previousKey,
            CTRL_P = '\u0010',
            CTRL_Q = '\u0011';

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

        stream.on('end', function() {
            exit(stream, isRaw);
        });

        container.start(function(err, data) {
            resize(container);
            process.stdout.on('resize', function() {
                resize(container);
            });

            container.wait(function(err, data) {
                exit(stream, isRaw);
            });

            if (!hasTerminal) {
                exit(stream, isRaw);
            }
        });
    },

    /**
     *
     * @param {DockerRunWrapper} dockerrunwrapper
     */
    runUsingApi(dockerrunwrapper) {

        var docker = dockerrunwrapper.getInstance();
        var optsc = dockerrunwrapper.buildApi();

        var me = this;

        docker.createContainer(optsc, function (err, container) {
            if (err) {
                console.log(err.message);
                return;
            }

            var attach_opts = {stream: true, stdin: true, stdout: true, stderr: true};

            container.attach(attach_opts, function (err, stream) {
                me.handleTerminal(err, stream, container, dockerrunwrapper.isInteractive());
            });
        });
    },

    /**
     *
     * @param {DockerRunWrapper} dockerrunwrapper
     */
    runUsingCli(dockerrunwrapper) {
        let dockerParams = dockerrunwrapper.buildConsole(true);

        const spawn = require('child_process').spawnSync;

        let options = {};
        if (dockerrunwrapper.isInteractive()) {
            options = {stdio: 'inherit'};
        }

        // const shell = require('shelljs');
        // shell.exec('docker ' + dockerParams.join(' '));

        let docker = spawn('docker', dockerParams, options);

        // Show the proper result.
        if (!dockerrunwrapper.isInteractive()) {
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
    },

    exec(instance, cmd) {
        var me = this;

        let docker = new Docker();
        let container = docker.getContainer(instance + '-container');
        container.exec({Cmd: cmd, AttachStdin: true, AttachStdout: true, Tty: true, OpenStdin: true}, function (err, exec) {
            if (err) {
                console.log(err.message);
                return;
            }

            exec.start( {stream: true, stdin: true, stdout: true, stderr: true}, function(err, stream) {
                me.handleTerminal(err, stream, container, true);
            });
        });
    },
};
