/**
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

assert = require('assert');

var timers = require('../index');
timers.install();

module.exports = {
    'package.json should parse': function(t) {
        t.expect(1);
        var json = require('../package.json');
        t.equal('qtimers', json.name);
        t.done();
    },

    'should expose globals': function(t) {
        var calls = [
            'setImmediate', 'clearImmediate',
            'setTimeout', 'clearTimeout',
            'setInterval', 'clearInterval',
            'currentTimestamp',
        ];
        for (var i=0; i<calls.length; i++) {
            t.ok(timers[calls[i]]);
            t.ok(global[calls[i]], "missing global call " + calls[i]);
        }
        t.done();
    },

    'should expose currentTimestamp': function(t) {
        // test the timer on the next tick, because loading sources
        // already caused the timestamp to drift
        function checkTimestamp() {
            var t1 = timers.currentTimestamp();
            var t2 = Date.now();
            t.ok(Math.abs(t2 - t1) <= 1);
        }
        t.expect(20);
        for (var i=1; i<=20; i++) setTimeout(checkTimestamp, i);
        setTimeout(function(){ t.done() }, 21);
    },

    'setImmediate': {
        'should expose maxTickDepth': function(t) {
            t.equal('number', typeof setImmediate.maxTickDepth);
            t.done();
        },

        'should return immediateObject': function(t) {
            t.equal('object', typeof setImmediate(function(){}));
            t.done();
        },

        'should invoke callback': function(t) {
            t.expect(1);
            setImmediate(function() {
                t.ok(1);
                t.done();
            });
        },

        'should not invoke callback if cleared': function(t) {
            t.expect(1);
            var im = setImmediate(function(){ t.ok(0); throw new Error("should not get called") });
            clearImmediate(im);
            setImmediate(function(){ t.ok(1); t.done(); });
        },

        'should invoke callback with 1 argument': function(t) {
            t.expect(2);
            setImmediate(function(a1) {
                t.equal(123, a1);
                t.equal(1, arguments.length);
                t.done();
            }, 123);
        },

        'should invoke callback with 3 arguments': function(t) {
            t.expect(4);
            setImmediate(function(a1, a2, a3) {
                t.equal(123, a1);
                t.equal(234, a2);
                t.equal(345, a3);
                t.equal(3, arguments.length);
                t.done();
            }, 123, 234, 345);
        },

        'should run rest of immediate queue after error': function(t) {
            return t.done();
            // TODO: umm... how to throw an error from inside the test that
            // neither kills the test nor node?  TBD.
            t.expect(4);
            process.once('uncaughtException', function(err) { });
            setImmediate(function(){ t.ok(1) });
            setImmediate(function(){ t.ok(1); throw new Error("deliberate error") });
            setImmediate(function(){ t.ok(1) });
            setImmediate(function(){ t.done() });
        },

        'should invoke 10000 callbacks': function(t) {
            var i, ncalls = 10000;
            t.expect(1);
            for (i=0; i<ncalls; i++) setImmediate(function() { --ncalls; if (ncalls === 0) { t.ok(1); t.done(); } });
        }
    },

    'setTimeout': {
        'should expose MIN_TIMEOUT': function(t) {
            t.equal('number', typeof setTimeout.MIN_TIMEOUT);
            t.done();
        },

        'should expose MAX_TIMEOUT': function(t) {
            t.equal('number', typeof setTimeout.MAX_TIMEOUT);
            t.done();
        },

        'should return timeoutObject': function(t) {
            t.equal('object', typeof setTimeout(function doneTimeout(){ t.done() }, 1));
        },

        'should invoke callback': function(t) {
            t.expect(1);
            setTimeout(function doneInvokeCallback(){ t.ok(1); t.done(); }, 1);
        },

        'should invoke callback only once': function(t) {
            t.expect(1);
            setTimeout(function(){ t.ok(1); }, 1);
            setTimeout(function(){ t.done(); }, 5);
        },

        'should invoke callbacks in timeout order': function(t) {
            var i, order = [];
            for (i=1; i<=40; i++) (function(i){ setTimeout(function(){ order.push(i); }, i); })(i);
            setTimeout(function timeoutOrderDone(){
                t.equal(order.length, 40);
                for (i=0; i<order.length-1; i++) assert(order[i] < order[i+1]);
                t.done();
            }, 42);
        },

        'should not invoke callback if cleared': function(t) {
            var zero = 0;
            var ti = setTimeout(function callbackCleared(){ zero = 1; }, 1);
            clearTimeout(ti);
            setTimeout(function doneCallbackCleared(){ assert(zero === 0); t.done(); }, 2);
        },

        'should invoke callback with 1 argument': function(t) {
            t.expect(2);
            setTimeout(function(a1){
                t.equal(arguments.length, 1);
                t.equal(a1, 11);
                t.done();
            }, 1, 11);
        },

        'should invoke callback with 3 arguments': function(t) {
            t.expect(4);
            setTimeout(function(a1, a2, a3){
                t.equal(arguments.length, 3);
                t.equal(a1, 11);
                t.equal(a2, 22);
                t.equal(a3, 33);
                t.done();
            }, 1, 11, 22, 33);
        },
    },

    'setInterval': {
        'should return intervalObject': function(t) {
            t.expect(2);
            var int = setInterval(function(){ clearInterval(int); t.ok(1); t.done() }, 2);
            t.equal('object', typeof int);
        },

        'should invoke callback': function(t) {
            t.expect(1);
            var int = setInterval(function(){ clearInterval(int); t.ok(1); t.done(); }, 1);
        },

        'should not invoke callback if cleared': function(t) {
            t.expect(1);
            var int = setInterval(function(){ clearInterval(int); t.ok(1); t.done(); }, 1);
            clearInterval(int);
            setTimeout(function(){ t.ok(1); t.done(); }, 1);
        },

        'should invoke callback multiple times': function(t) {
            var ntimes = 0;
            t.expect(1);
            var int = setInterval(function(){ ntimes++; if (ntimes >= 10) { clearInterval(int); t.ok(1); t.done(); } }, 1);
        },
    },
};
