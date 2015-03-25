/**
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

module.exports = require('./lib/qtimers.js');


var version = process.version.split('.');
var existingCalls = null;
// node v0.8 and before did not have setImmediate et al
if (version[0] == 0 && version[1] < 10) existingCalls = {
    setImmediate: setImmediate,
    clearImmediate: clearImmediate,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    currentTimestamp: global.currentTimestamp,
};

module.exports.install = function( ) {
    var i;
    if (existingCalls) for (i in existingCalls) global[i] = module.exports[i];
    else {
        setImmediate = module.exports.setImmediate;
        clearImmediate = module.exports.clearImmediate;
        setTimeout = module.exports.setTimeout;
        clearTimeout = module.exports.clearTimeout;
        setInterval = module.exports.setInterval;
        clearInterval = module.exports.clearInterval;
        currentTimestamp = module.exports.currentTimestamp;
    }
};

module.exports.uninstall = function( ) {
    var i;
    if (existingCalls) for (i in existingCalls) global[i] = existingCalls[i];
    else {
        setImmediate = undefined;
        clearImmediate = undefined;
        setTimeout = undefined;
        clearTimeout = undefined;
        setInterval = undefined;
        clearInterval = undefined;
        currentTimestamp = undefined;
    }
};

// the default is to install our calls in place of the builtins
module.exports.install();
