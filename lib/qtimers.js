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
module.exports.currentTimestamp = function() { return getTimestamp() };

// setImmediate tasks are queued on the immediateList
var immediateList = new List();

// timeoutHeap stores the timeout timestamps in sorted order
var timeoutHeap = new Heap({compar: function(a,b) { return a < b ? -1 : 1}});

// timeoutHash has the timeout queues by timeout timestamp
var timeoutHash = {};

// pendingTimeouts counts the number of referenced timeout tasks
var pendingTimeouts = 0;

function createTimer( callback ) {
    var timer = new Timer();
    if (['0.4.', '0.6.', '0.8.', '0.9.', '0.10'].indexOf(process.versions.node.slice(0, 4)) >= 0) {
        // set the node v0.10.29 callback field
        timer.ontimeout = callback;
    }
    else {
        // set the node v0.11.13 callback field
        timer[0] = callback;
    }
    return timer;
}
// the timeout timer processes setTimeout and setInterval tasks
// the timeout timer runs every tick
var timeoutTimer = createTimer(_processTimeoutTasks);
timeoutTimer._running = 1;
timeoutTimer.start(0, 1);
function startTimeoutTimer() { timeoutTimer._running = 1; timeoutTimer.start(0, 1); }
function stopTimeoutTimer() { timeoutTimer.stop(); timeoutTimer._running = 0; }

// the idle timer processes unref-d events when the system is otherwise idle
// The idle timer runs every 10th tick, after timeoutTimer has run, so it only
// has anything to do if the system is idle and timeoutTimer has been stopped.
// Because unreferenced timers are inherently low priority, can even be skipped,
// run the idle timer only 100x per second to not use much cpu.
var idleTimer = createTimer(_processTimeoutTasks);
idleTimer.unref();
idleTimer.start(5, 10);

// timestamp holds the current time and is updated every ms by timeoutTimer.
// Calls queued by setTimeout use
// if a call runs longer than a ms, setTimeout calls queued by calls that
// timed out that millisecond will 
var timestamp;
function setTimestamp( ) { timestamp = Date.now(); return timestamp; }
function getTimestamp( ) { if (timestamp) return timestamp; else return setTimestamp(); }


// the canonical immediate, timeout and interval items
function immediateItemTemplate( fn ) {
    return {_callback: fn, _domain: process.domain, _removed: 0}; }
function timeoutItemTemplate( fn ) {
    return {_callback: fn, _domain: process.domain, _removed: 0, _isref: 1, _when: 0, _interval: 0, ref: refItem, unref: unrefItem}; }
function refItem() {
    if (!this._isref && this._callback) { this._isref = 1; pendingTimeouts += 1; } }
function unrefItem() {
    if (this._isref && this._callback) { this._isref = 0; pendingTimeouts -= 1; } }


function setImmediate( fn ) {
    //var item = immediateItemTemplate(fn);
    var item = {_callback: fn, _domain: process.domain, _removed: 0};
    var len = arguments.length;

    if (len === 1) {
        //
    }
    else if (len === 2) {
        var a = arguments[1];
        item._callback = function(){ fn(a) };
    }
    else {
        // 30% slower to pass arguments to slice (prevents optimization)
        var i, args = new Array();
        for (i=1; i<len; i++) args.push(arguments[i]);
        item._callback = function(){ fn.apply(null, args) };
    }
    immediateList.push(item);

    if (!process._needImmediateCallback) {
        process._needImmediateCallback = true;
        process._immediateCallback = _processImmediateTasks;
    }

    return item;
}

setImmediate.maxTickDepth = 10;

function clearImmediate( item ) {
    if (item && item._callback) {
        //immediateList.remove(item);
        //item._removed = 1;
        item._callback = 0;
    }
}


function _createTimeoutItem( fn, ms, argv ) {
    var item = timeoutItemTemplate(fn);

    ms -= 0;  // coerce type to number or NaN
    item._when = getTimestamp() + ((ms >= setTimeout.MIN_TIMEOUT && ms <= setTimeout.MAX_TIMEOUT) ? ms : setTimeout.MIN_TIMEOUT);

    if (argv.length === 0) {
        item._callback = fn;
    }
    else if (argv.length === 1) {
        item._callback = function(){ fn(argv[0]) };
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
        timeoutHeap.push(when);
    }
    bucket.push(item);

    // first bump pending count, only then start timer (else race condition)
    if (item._isref) pendingTimeouts += 1;
    if (!timeoutTimer._running) startTimeoutTimer();

    return item;
}

function setTimeout( fn, ms ) {
    var i, args = [];
    for (i=2; i<arguments.length; i++) args.push(arguments[i]);
    var item = _createTimeoutItem(fn, ms, args);
    return _scheduleTimeoutItem(item, item._when);
}

setTimeout.MIN_TIMEOUT = 1;
setTimeout.MAX_TIMEOUT = 0x80000000 - 1;

function clearTimeout( item ) {
    var bucket;
    if (item && item._callback /*&& (bucket = timeoutHash[item._when])*/) {
        //bucket.remove(item);
        //item._removed = 1;
        if (item._isref) item.unref();
        item._callback = 0;
    }
}


function setInterval( fn, ms ) {
    var i, args = [];
    for (i=2; i<arguments.length; i++) args.push(arguments[i]);
    var item = _createTimeoutItem(fn, ms, args);
    item._interval = ms;

    var userCallback = item._callback;
    item._callback = function recurringCallback() {
        userCallback();
        if (item._interval) {
            item._when += item._interval;
            _scheduleTimeoutItem(item, item._when);
        }
    };
    _scheduleTimeoutItem(item, item._when);

    return item;
}

function clearInterval( item ) {
    clearTimeout(item);
}


function _invokeCallback( cb ) {
    try { cb(); }
    catch (err) { return err; }
}

function _invokeCallbackInDomain( cb, domain ) {
    try { domain.enter(); cb(); domain.exit(); }
    catch (err) { return err; }
}

function _invokeCallbackMaybeDomain( cb, domain ) {
    // simpler, but slower...
    //if (!domain || domain === process.domain) return _invokeCallback(cb);
    //else if (!domain._disposed) return _invokeCallbackInDomain(cb, domain);
    try {
        // TODO: can the current domain ever be _diposed?
        if (!domain || domain === process.domain) { cb(); }
        else if (domain._disposed) { return ; }
        else { domain.enter(); cb(); domain.exit(); }
    }
    catch (err) {
        return err;
    }
}

function _processTasklist( list ) {
    var domain = process.domain;
    var refCount = 0;
    var err;

    // try to use plain arrays for the task lists:
    // node-v0.10.29: 6.75m/s for 1m
    var item, err;
    while ((item = list.shift())) {
        if (!item._callback) continue;
        if ((err = _invokeCallbackMaybeDomain(item._callback, item._domain))) {
            pendingTimeouts -= refCount + item._isref;
            // if error thrown, let it percolate up through the domains,
            // and arrange for process.nextTick to process rest of list
            // with a clean (null) domain
            // note: nextTick funcs run before setImmediate,Timeout funcs,
            // so tasklist processing will complete before immed tasks are run
            process.domain = null;
            process.nextTick(function(){ _processTasklist(list) });
            throw err;
        }
        refCount += item._isref;
    }

    process.domain = domain;
    return refCount;
}


// called as needed from setImmediate
function _processImmediateTasks( ) {
    var domain = process.domain;
    var list = immediateList;
    // qtimers v0.10 1x = 1.0m/s; 5x = 3.7m/s, 10x = 5.4m/s, 20x = 6.7m/s, 100x = 9.0m/s; unlimited = 9.3m/s
    // v0.10 nodejs timers.js only runs 1 immediate call per loop (maxDepth=1 + length * 0)
    // v0.12 nodejs timers.js runs entire existing immediate list, but not recursive calls (maxDepth=0 + length * 1)
    // qtimers limits the count of immediate calls run, default 10
    var maxDepth = setImmediate.maxTickDepth;
    if (maxDepth <= 0) {
        if (maxDepth == 0) maxDepth = list.length();
        else maxDepth = list.length() + -maxDepth;
    }
    var i, n = 0;
    var item, err;

    while (++n <= maxDepth && (item = list.shift())) {
        if (item._callback) {
            if ((err = _invokeCallbackMaybeDomain(item._callback, item._domain))) throw err;
        }
    }

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
        var when = timeoutHeap.shift();
        var list = timeoutHash[when];
        delete timeoutHash[when];
        var refCount = _processTasklist(list);
        pendingTimeouts -= refCount;
        timestamp = setTimestamp();

        // if way backlogged, quickly check the event queue then continue here
        if (nbuckets++ > 2) setImmediate(_processTimeoutTasks);
    }
    if (!pendingTimeouts && immediateList.isEmpty()) {
        // the timeout clock is always running, but unref it so that the program can exit
        stopTimeoutTimer();
    }
}
