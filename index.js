/**
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

module.exports = require('./lib/qtimers.js');


existingCalls = {
    setImmediate: global.setImmediate || false,
    clearImmediate: global.clearImmediate || false,
    setTimeout: global.setTimeout || false,
    clearTimeout: global.clearTimeout || false,
    setInterval: global.setInterval || false,
    clearInterval: global.clearInterval || false,
    currentTimestamp: global.currentTimestamp || false,
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
