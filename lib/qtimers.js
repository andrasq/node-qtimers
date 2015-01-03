/**
 * nodejs require('timers') work-alike with setImmediate, setTimeout, etc
 *
 * Copyright (C) 2014-2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var Timer = process.binding('timer_wrap').Timer;
var Heap = require('qheap');
var List = require('qlist');

module.exports.setImmediate = setImmediate;
module.exports.clearImmediate = clearImmediate;
module.exports.setTimeout = setTimeout;
module.exports.clearTimeout = clearTimeout;
module.exports.setInterval = setInterval;
module.exports.clearInterval = clearInterval;


// setImmediate tasks are queued on the immediateList
var immediateList = new List();

// timeoutHeap stores the timeout timestamps in sorted order
var timeoutHeap = new Heap({compar: function(a,b) { return a < b ? -1 : 1}});

// timeoutHash has the timeout queues by timeout timestamp
var timeoutHash = {};

// pendingTimeouts counts the number of referenced timeout tasks
var pendingTimeouts = 0;

// the timeout timer runs setTimeout and setInterval tasks
var timeoutTimer = new Timer();
timeoutTimer.ontimeout = _processTimeoutTasks;  // node v0.10.29 callback
timeoutTimer[0] = _processTimeoutTasks;         // node v0.11.13 callback
timeoutTimer._running = 0;
function startTimeoutTimer() { timeoutTimer._running = 1; timeoutTimer.start(1, 1); setTimestamp(); }
function stopTimeoutTimer() { timeoutTimer.stop(); timeoutTimer._running = 0; }

// timestamp holds the current time and is updated every ms by timeoutTimer.
// Calls queued by setTimeout use
// if a call runs longer than a ms, setTimeout calls queued by calls that
// timed out that millisecond will 
var timestamp = Date.now();
var timestampUses = 0;
function setTimestamp( ) { timestamp = Date.now(); timestampUses = 0; return timestamp; }
function getTimestamp( ) { if (!timeoutTimer._running || timestampUses > 100) setTimestamp(); timestampUses += 1; return timestamp; }

function copyObject( o ) {
    var i, o2 = {};
    for (i in o) o2[i] = o[i];
    return o2;
}

function ImmediateItem() {
    this._domain = process.domain;
}
ImmediateItem.prototype = {_callback: 0, _domain: 0, _removed: 0};

function setImmediate( fn ) {
    var item = {_callback: 0, _domain: process.domain, _removed: 0};
    //item.domain = process.domain;

    if (arguments.length === 1) {
        item._callback = fn;
    }
    else if (arguments.length === 2) {
        var a = arguments[1];
        item._callback = function(){ fn(a) };
    }
    else {
        // 30% slower to pass arguments to slice (prevents optimization)
        var i, args = new Array(), len = arguments.length;
        for (i=1; i<len; i++) args.push(arguments[i]);
        item._callback = function(){ fn.apply(null, args) };
    }

    immediateList.push(item);

    if (!process._needImmediateCallback) {
        process._needImmediateCallback = true;
        process._immediateCallback = _processImmediateTasks;
    }
    // else { TODO: install our handler, but call previous handler too? }

    return item;
}

// maxTickDepth limits how many back-to-back immediate calls to make
// Properly (per setImmediate documentation) this should be 1, but
// programs run 6x faster with a higher value.
setImmediate.maxTickDepth = 10;

function clearImmediate( item ) {
    if (item && item._callback) {
        //immediateList.remove(item);
        //item._removed = 1;
        item._callback = 0;
    }
}


function TimeoutItem() {
    this._domain = process.domain;
}
TimeoutItem.prototype = copyObject(ImmediateItem.prototype);
TimeoutItem.prototype._isref = 1;
TimeoutItem.prototype._when = 0;
TimeoutItem.prototype._interval = 0;
TimeoutItem.prototype.ref = function() { if (!this._isref && this._callback) { this._isref = 1; pendingTimeouts += 1; } }
TimeoutItem.prototype.unref = function() { if (this._isref && this._callback) { this._isref = 0; pendingTimeouts -= 1; } }

function _createTimeoutItem( fn, ms, argv ) {
    var timestamp = getTimestamp();
    var item = new TimeoutItem();

    // valid timeouts are 1..(2^31 - 1), else use 1
    ms |= 0;
    //item._when = timestamp + ((ms >= 1 && ms < 0x80000000) ? ms : 1);
    item._when = timestamp + ((ms >= setTimeout.MIN_TIMEOUT && ms <= setTimeout.MAX_TIMEOUT) ? ms : setTimeout.MIN_TIMEOUT);

    if (argv.length === 0) {
        item._callback = fn;
    }
    else if (argv.length === 1) {
        var a = argv[0];
        item._callback = function(){ fn(a) };
    }
    else {
        item._callback = function(){ fn.apply(null, argv) };
    }
    return item;
}

function _scheduleTimeoutItem( item, when ) {
    var bucket = timeoutHash[when];
    if (!bucket) {
        bucket = timeoutHash[when] = new Array();
        timeoutHeap.put(when);
    }
    bucket.push(item);

    if (item._isref) pendingTimeouts += 1;
    if (!timeoutTimer._running) startTimeoutTimer();

    return item;
}

function setTimeout( fn, ms ) {
    if (arguments.length < 3) {
        var item = _createTimeoutItem(fn, ms, []);
    }
    else {
        var i, args = new Array(), len = arguments.length;
        for (i=2; i<len; i++) args.push(arguments[i]);
        var item = _createTimeoutItem(fn, ms, args);
    }
    return _scheduleTimeoutItem(item, item._when);
}

setTimeout.MIN_TIMEOUT = 1;
setTimeout.MAX_TIMEOUT = 0x80000000 - 1;

function clearTimeout( item ) {
    var bucket;
    if (item && item._callback /*&& (bucket = timeoutHash[item._when])*/) {
        //bucket.remove(item);
        //item._removed = 1;
        item.unref();
        item._callback = 0;
    }
}


function setInterval( fn, ms ) {
    var i, args = new Array();
    for (i=0; i<arguments.length; i++) args.push(arguments[i]);

    var item = setTimeout.apply(null, arguments);
    var userCallback = item._callback;
    item._interval = ms;
    item._callback = recurringCallback;

    function recurringCallback() {
        userCallback();
        if (item._interval) {
            item._when = getTimestamp() + item._interval;
            _scheduleTimeoutItem(item, item._when);
        }
    };

    return item;
}

function clearInterval( item ) {
    clearTimeout(item);
}


function _invokeCallback( cb ) {
    try {
        cb();
    }
    catch (err) {
        return err;
    }
}

function _invokeCallbackInDomain( cb, domain ) {
    try {
        domain.enter();
        cb();
        domain.exit();
    }
    catch (err) {
        return err;
    }
}

function _processTask( item ) {
    var domain = process.domain;

    var callback = item._callback;
    if (!callback) return;
    var itemdomain = item._domain;
    var err;

    if (itemdomain) {
        if (itemdomain._disposed) return;
        if (itemdomain === domain) err = _invokeCallback(callback);
        else err = _invokeCallbackInDomain(callback);
    }
    else {
        err = _invokeCallback(callback);
    }

    process.domain = domain;
    return err;
}

function _processTasklist( list ) {
    var domain = process.domain;
    var refCount = 0;
    var err;

    // try to use plain arrays for the task lists:
    // node-v0.10.29: 6.75m/s for 1m
    var item, err;
    while ((item = list.shift())) {
        // 4% faster to inline, but duplicates lots of code
        err = _processTask(item);
        refCount += item._isref;
        if (err) {
            pendingTimeouts -= refCount;
            // if error thrown, let it percolate up through the domains,
            // and arrange for process.nextTick to process rest of list
            // with a clean (null) domain
            // note: nextTick funcs run before setImmediate,Timeout funcs,
            // so tasklist processing will complete before new tasks are run
            process.domain = null;
            process.nextTick(function(){ _processTasklist(list) });
            throw err;
        }
    }

    process.domain = domain;
    return refCount;
}


// called as needed from setImmediate
function _processImmediateTasks( ) {
    var domain = process.domain;
    var list = immediateList;
    // processing 1x = 1m/s; 5x = 3.1m/s, 10x = 4m/s, 20x = 5m/s, 100x = 5.9m/s; unlimited = 6.3m/s
    // nodejs timers.js only runs maxDepth=1, 1 immediate call per loop
    var maxDepth = setImmediate.maxTickDepth;
    var i, n = 0;
    var item, err;

    while ((item = list.shift())) {
        err = _processTask(item);
        if (err) throw err;
        if (++n >= maxDepth) break;
    }

    // TODO: if (process._immediateCallback !== _processImmediateTasks) {
    //     install our handler, arrange to call previous handler too
    //     previous handlers go into a list, and checked to only be called 1x
    // }

    if (!item) process._needImmediateCallback = false;
    process.domain = domain;
}


// called every ms by timeoutTimer via the event loop
// note that even though only 1 setImmediate is to be processed per call,
// all waiting setTimeout tasks are processed before any evented io is handled
function _processTimeoutTasks( ) {
    var timestamp = setTimestamp();
    var nbuckets = 0;
    while (timeoutHeap.peek() <= timestamp) {
        var when = timeoutHeap.get();
        var list = timeoutHash[when];
        //delete timeoutHash[when];
        timeoutHash[when] = 0;
        var refCount = _processTasklist(list);
        pendingTimeouts -= refCount;
        timestamp = setTimestamp();

        // if way backlogged, quickly check the event queue then continue here
        if (++nbuckets > 2) {
            var immediateTimer = new Timer();
            immediateTimer.ontimeout = _processTimeoutTasks;
            immediateTimer[0] = _processTimeoutTasks;
            immediateTimer.start(0, 0);
            break;
        }
    }
    if (!pendingTimeouts && immediateList.isEmpty()) {
        stopTimeoutTimer();
    }
}
