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
var timeoutHash = new Object();

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

/*
 * the timeout timer processes setTimeout and setInterval tasks
 */
var timeoutTimer = createTimer(_processTimeoutTasks);

/*
 * the idle timer processes unref-d tasks when the system is otherwise idle
 * It only runs if the system is idle and timeoutTimer has been stopped.
 */
var idleTimer = createTimer(_processTimeoutTasks);
if (idleTimer.unref) idleTimer.unref();
// TODO: node-v0.8 cannot unref, needs an alternate way to know when ok to exit

/*
 * reset the appropriate timer for the next expiration,
 * or turn off both timers when not needed
 */
function scheduleTimer( when, now ) {
    idleTimer.stop();
    timeoutTimer.stop();
    if (when > 0) {
        // If more ref-d tasks left, schedule the next timeoutTimer wakeup.
        // If only unrefd tasks left, stop the timeout timer so program can exit;
        // instead, use the idle timer, which is not sticky.
        var timer = pendingTimeouts ? timeoutTimer : idleTimer;
        timer.start(when > now ? when - now : 0, 1);
    }
}

/*
 * timestamp holds the current time and is updated every ms by timeoutTimer.
 * Calls queued by setTimeout use
 * if a call runs longer than a ms, setTimeout calls queued by calls that
 * timed out that millisecond will
 */
var timestamp;
function setTimestamp( ) { timestamp = Date.now(); return timestamp; }
function getTimestamp( ) { if (timestamp) return timestamp; else return setTimestamp(); }


/*
 * the canonical immediate and timeout items and factories
 */
function ImmediateItem( ) { }
ImmediateItem.prototype = { _callback: null, _argv: null, _domain: null };
function immediateItemTemplate( fn, av ) {
    return {_callback: fn, _argv: av, _domain: null}; };
function TimeoutItem( ) { }
TimeoutItem.prototype = {_callback: null, _argv: null, _domain: null, _isref: 1, _when: 0, _interval: 0, ref: refItem, unref: unrefItem};
function timeoutItemTemplate( fn, av ) {
    return {_callback: fn, _argv: av, _domain: null, _isref: 1, _when: 0, _interval: 0, ref: refItem, unref: unrefItem}; }
function refItem( ) {
    if (!this._isref && this._callback) { this._isref = 1; pendingTimeouts += 1; } }
function unrefItem( ) {
    if (this._isref && this._callback) { this._isref = 0; pendingTimeouts -= 1; } }


function setImmediate( fn ) {
    var args;
    switch (arguments.length) {
    case 0: case 1: break;
    case 2: args = [arguments[1]]; break;
    case 3: args = [arguments[1], arguments[2]]; break;
    case 4: args = [arguments[1], arguments[2], arguments[3]]; break;
    default:
        args = new Array(arguments.length - 1);
        for (var i=1; i<arguments.length; i++) args[i-1] = arguments[i];
    }

    var item = { _domain: process.domain, _callback: fn, _argv: args };
    immediateList.push(item);
    _scheduleImmediateItem();

    return item;
}

function _scheduleImmediateItem( ) {
    if (!process._needImmediateCallback) {
        process._needImmediateCallback = true;
        process._immediateCallback = _processImmediateTasks;
    }
}

// default to running all waiting immediate tasks, + up to 10 newly queued ones
setImmediate.maxTickDepth = -10;

function clearImmediate( item ) {
    if (item && item._callback) {
        item._callback = 0;
    }
}


function _createTimeoutItem( fn, ms, argv ) {
    var item = timeoutItemTemplate(fn, argv);
    //var item = {_callback: fn, _argv: argv, _domain: null, _isref: 1, _when: 0, _interval: 0, ref: refItem, unref: unrefItem};

    ms -= 0;  // coerce type to number or NaN
    // note: should properly range-clip ms (instead of emulating node and defaulting to MIN_TIMEOUT)
    item._when = getTimestamp() + ((ms >= setTimeout.MIN_TIMEOUT && ms <= setTimeout.MAX_TIMEOUT) ? ms : setTimeout.MIN_TIMEOUT);

    if (process.domain) item._domain = process.domain;

    return item;
}

function _scheduleTimeoutItem( item, when ) {
    // first bump pending count, only then start timer (else race condition in _processTimeoutTasks)
    if (item._isref) pendingTimeouts += 1;

    // much much faster to index a hash by a string
    var whenKey = when + '';
    if (timeoutHash[whenKey]) {
        timeoutHash[whenKey].push(item);
    }
    else {
        timeoutHash[whenKey] = [ item ];
        timeoutHeap.push(when);
        scheduleTimer(1, 0);
    }

    return item;
}

function setTimeout( fn, ms, a, b, c ) {
    var args;
    switch (arguments.length) {
    case 0: case 1: case 2: break;
    case 3: args = [a]; break;
    case 4: args = [a, b]; break;
    case 5: args = [a, b, c]; break;
    default:
        args = new Array(arguments.length - 2);
        for (var i=2; i<arguments.length; i++) args[i-2] = arguments[i];
    }
    var item = _createTimeoutItem(fn, ms, args);
    return _scheduleTimeoutItem(item, item._when);
}

setTimeout.MIN_TIMEOUT = 1;
setTimeout.MAX_TIMEOUT = 0x80000000 - 1;

function clearTimeout( item ) {
    if (item && item._callback) {
        // much faster to skip cleared tasks in process loop than to remove now
        if (item._isref) item.unref();
        item._callback = 0;
    }
}


function setInterval( fn, ms, a, b, c ) {
    var args;
    switch (arguments.length) {
    case 0: case 1: case 2: break;
    case 3: args = [a]; break;
    case 4: args = [a, b]; break;
    case 5: args = [a, b, c]; break;
    default:
        args = new Array(arguments.length - 2);
        for (var i=2; i<arguments.length; i++) args[i-2] = arguments[i];
    }
    var item = _createTimeoutItem(fn, ms, args);
    ms = +ms;
    if (ms < setTimeout.MIN_TIMEOUT || ms > setTimeout.MAX_TIMEOUT) ms = setTimeout.MIN_TIMEOUT;
    item._interval = ms;

    // TODO:
    // TODO: for the timeout _callback, always save a static function that receives the item
    // and make _processTimeoutTasks pass the item (actually, runCallbackItem already does, as `this`)
    // Then no need for per-recurring timeout closure, just re-queue it when it triggers! (see _interval)
    // BUT this needs timeouts to be invoked with `this` set to the timer object like immediates (work in progress)
    // (so the callback will call the use-specified repeat func from inside runCallback)
    // eg:
    // item._callback = function rep() { this._callback = this._func; _runCallbackItem(this); this._callback = rep;
    //                                   this._when = ...; _scheduleTimeoutItem(this, this._when); };
    // item._func = fn;
    // item._argv = args;

    var userCallback = item._callback;
    item._callback = function recurringCallback() {
        _runCallback(userCallback, item._argv);
        if (item._interval) {
            // like node, schedule the next activation from the current time
            // unlike node, getTimestamp() returns the start of the timeout event loop epoch
            item._when = getTimestamp() + item._interval;
            _scheduleTimeoutItem(item, item._when);
        }
    };
    _scheduleTimeoutItem(item, item._when);

    return item;
}

function clearInterval( item ) {
    clearTimeout(item);
}


// run the callback, return any error thrown
function _runCallback( cb, av ) {
    if (av) switch (av.length) {
    case 0: cb(); break;
    case 1: cb(av[0]); break;
    case 2: cb(av[0], av[1]); break;
    case 3: cb(av[0], av[1], av[2]); break;
    default: cb.apply(null, av); break;
    }
    else cb();
}

function _runCallbackItem( item ) {
    var argv = item._argv;
    var argc = argv ? argv.length : 0;
    switch (argc) {
    case 0: item._callback(); break;
    case 1: item._callback(argv[0]); break;
    case 2: item._callback(argv[0], argv[1]); break;
    case 3: item._callback(argv[0], argv[1], argv[2]); break;
    default: item._callback.apply(item, argv); break;
    }
}

function _tryCallback( cb, av ) {
    try { _runCallback(cb, av) }
    catch (err) { return err }
}

function _tryCallbackItem( item ) {
    try { _runCallbackItem(item); }
    catch (err) { return err; }
}

// run the callback in the given domain, return any error thrown
function _invokeCallbackMaybeDomain( cb, av, domain ) {
    if (!domain) {
        return _tryCallback(cb, av);
    }
    else if (!domain._disposed) {
        // timeouts and immediates are run with an empty domain
        domain.enter();
        var err = _tryCallback(cb, av);
        // do not exit domain when error, re-throw later still in the error domain
        if (err) return err;
        domain.exit();
    }
}

function _nextTickEmptyDomain( fn ) {
    var domain = process.domain;
    process.domain = null;
    process.nextTick(fn);
    process.domain = domain;
}

function _processTasklist( list ) {
    var refCount = 0;
    var err;

    // try to use plain arrays for the task lists:
    // node-v0.10.29: 6.75m/s for 1m
    var item, err;
    for (var i=0; i<list.length; i++) {
        item = list[i];
        if (!item._callback) continue;
        if ((err = _invokeCallbackMaybeDomain(item._callback, item._argv, item._domain))) {
            pendingTimeouts -= refCount + item._isref;
            if (i+1 < list.length) {
                // arrange for the other tasks to be run asap if err is not fatal
                // nextTick funcs are run before next event loop cycle starts
                list = list.slice(i+1);
                _nextTickEmptyDomain(function(){ _processTasklist(list) });
            }
            // process.domain still set, caller will re-throw the error
            return err;
        }
        // race condition? gather up ref count to subtract at very end
        refCount += item._isref;
    }

    pendingTimeouts -= refCount;
}


function _getImmediateLimit( ) {
    var limit = setImmediate.maxTickDepth;
    return limit > 0 ? limit : immediateList.length() + -limit;
// FIXME: broken! need the count if un-cleared items on the list, not the immediateList length
// as implemented, counts list entries, not valid items
}

// called as needed from setImmediate
function _processImmediateTasks( limit ) {
    var list = immediateList, maxDepth = limit || _getImmediateLimit();
    var item, err, n = 0;

    while (n < maxDepth && (item = list.shift())) {
        n++;
        if (!item._callback) continue;

        // if (item._domain) if (item._domain.disposed) continue; else item._domain.enter();

        // if ((err = _tryCallbackItem(item))) {
        if ((err = _invokeCallbackMaybeDomain(item._callback, item._argv,  item._domain))) {
            // finish running the other immediate tasks if the error is not fatal
            if (n < maxDepth) _nextTickEmptyDomain(function(){ _processImmediateTasks(maxDepth - n); });
            throw err;
        }

        // if (item._domain) item._domain.exit();
    }

    if (!item) process._needImmediateCallback = false;
}


// called every ms by timeoutTimer via the event loop
// note that even though only 1 setImmediate is processed by node per call (v0.10),
// all waiting setTimeout tasks are processed before any evented io is handled
function _processTimeoutTasks( ) {
    var timestamp = setTimestamp();
    var nbuckets = 0;

    while (timeoutHeap.peek() <= timestamp) {
        var when = timeoutHeap.shift();
        var whenKey = when + '';
        var list = timeoutHash[whenKey];
        delete timeoutHash[whenKey];
        var err = _processTasklist(list);
        if (err) {
            // if a timeout threw, arrange to finish running the other tasks
            // and re-throw in the same domain as the error
            _nextTickEmptyDomain(_processTimeoutTasks);
            throw err;
        }
        timestamp = setTimestamp();

        // if way backlogged, quickly check the event queue then continue here
        // NOT: be more predictable, run timeouts and immediates in well-defined order
        // if (nbuckets++ > 2) { if (timeoutHeap.peek() <= timestamp) setImmediate(_processTimeoutTasks); break; }
    }

    var nextTimeout = timeoutHeap.peek();
    scheduleTimer(nextTimeout, timestamp);
}


// debug:
module.exports._qt = {
    timeoutHeap: timeoutHeap,
    immediateList: immediateList,
}
