/**
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

module.exports = require('./lib/qtimers.js');


var existingCalls = {
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
    for (i in existingCalls) global[i] = module.exports[i];
};

module.exports.uninstall = function( ) {
    var i;
    for (i in existingCalls) global[i] = existingCalls[i];
};

// the default is to install our calls in place of the builtins
module.exports.install();
