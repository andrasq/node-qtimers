qtimers
=======

a fast drop-in replacement for `require('timers')` with support for
setImmediate, setTimeout, etc.

QTimers uses faster internal data structures than the builtin nodejs
timers.js, and (optionally) relaxes some nodejs limitations.  The speedups are
from a combination of:

- fast circular buffer for immediate tasks, not a linked list
- better v8 optimization (eg not passing `arguments` to array.slice)
- fast-path single-argument callbacks too
- multiple immediate calls before checking event loop
- better reuse of timestamps

Development was primarily with node-v0.10.29.  Actual runtimes vary, but
substantial speedups were seen with node-v0.12, node-v0.11.13, and iojs
as well.

In addition to being faster, qtimers invokes all callbacks in a well-defined
order:  immediates in queueing order and timeouts in expiration order.  Node
v0.10.29 sometimes calls timeout functions out of sequence (running a later
function before the earlier), which can result in very subtle and hard-to-find
glitches.


Examples
--------

Install QTimers, exit in 1 second:

        require('qtimers');
        setTimeout(process.exit, 1000);

Exit immediately:

        require('qtimers');
        t = setTimeout(process.exit, 1000);
        t.unref();

Write 100 dots:

        require('qtimers');
        for (i=0; i<100; i++) setImmediate(function(){ process.stdout.write(".") });

Loop a million times, quickly:

        require('qtimers');
        nleft = 1000000;
        function loop() { if (--nleft > 0) setImmediate(loop); }
        loop();
        // maxTickDepth = 100: 0.12 sec
        // maxTickDepth = 10:  0.20 sec
        // maxTickDepth = 1:   0.91 sec
        // node-v0.10.29:      1.77 sec
        // node-v0.12:         2.25 sec

Loop a million times, less quickly:

        require('qtimers');
        function loop(nleft) { if (--nleft > 0) setImmediate(loop, nleft); }
        loop(1000000);
        // maxTickDepth = 100: 0.42 sec
        // maxTickDepth = 10:  0.50 sec
        // maxTickDepth = 1:   1.3  sec

Loop a million times, slowly:

        function loop(nleft) { if (--nleft > 0) setImmediate(loop, nleft); }
        loop(1000000);
        // node-v0.10.29:     14.4  sec
        // node-v0.12:         3.4 sec


Timer Calls
-----------

QTimers supports all the functionality provided by the node built-in.

### setImmediate( fn, [arg1, ...] )

Arrange for fn() to be called with the provided arguments after the current
thread exits.  Returns an opaque immediateObject that can be used to cancel
the call.  SetImmediate functions are run in the order added.  Up to
`setImmediate.maxTickDepth` functions are run before checking the event loop
(default 10).

Note that node v0.10 ran only 1 immediate callback between checks of the event
loop.  Node v0.12 runs all queued callbacks.  QTimers can mimic both these
behaviors (set `maxTickDepth` below), but defaults to running a fixed count,
regardless of whether queued already or queued by the immediate callback that
just ran.  This affords control over the tradeoff between not starving events
vs minimizing the immediate queue overhead, which is substantial.

### clearImmediate( immediateObject )

Cancel the immediate callback.

### setTimeout( fn, ms, [arg1, ...])

Arrange for fn() to be called after a delay of `ms` milliseconds.  Returns a
timeoutObject.

### clearTimeout( timeoutObject )

Cancel the timeout callback.

### setInterval( fn, ms, [arg1, ...])

Arrange for fn() to be called after a delay of `ms` milliseconds and every
`ms` thereafter.  Returns an intervalObject.

### clearInterval( intervalObject )

Cancel the interval callback.

The opaque timer objects returned by setTimeout and setInterval provide a
method `unref()`.  Calling unref will prevent that timer from keeping the
program running if there are no other events left pending.  The `ref()` method
will undo an unref.

### timeoutObject.unref( ), intervalObject.unref( )

Do not stop the program from exiting just because this timer is active.

### timeoutObject.ref( ), intervalObject.ref( )

Disable unref, do not exit the program as long as this timer is active.
Timeout timers deactivate when run; interval timers remain active until
canceled.

Timer Extras
------------

In addition, QTimers allows adjusting some internal parameters and provides
additional functionality:

### setTimeout.MIN_TIMEOUT = 1

The shortest permitted timeout for setTimeout and setInterval functions, in
milliseconds.  Default 1.  Note that setting MIN_TIMEOUT to 0 is not the same
as using setImmediate:  timeouts are quantized to millisecond intervals, so
the function will get called after a period of delay of as much as 1 ms.

### setTimeout.MAX_TIMEOUT = (2**31 - 1)

The longest permitted timeout for setTimeout and setInterval, in milliseconds.
Default (2 ^ 31) - 1, is the largest positive 32-bit twos-complement integer.
Note that setting MAX_TIMEOUT low is not the same as capping the delay:  if
the timeout delay is outside the valid range, a delay of MIN_TIMEOUT (1 ms) is
used instead.

### setImmediate.maxTickDepth = 10

The number of setImmediate callbacks to call before checking the event loop.
Any callbacks not run will be handled after the event loop has been processed.

QTimers runs immediate callbacks by count, not by when queued.  The app can tune
the number of callbacks to run at a time:  a fixed count (even those queued
during the processing of the immediate queue), those already on the queue, or
a fixed count more than already queued.

The QTimers behavior is configured by setting maxTickDepth appropriately:

- v0.10 compatible: `maxTickDepth = 1` runs one immediate call at a time
- v0.12 compatible: `maxTickDepth = 0` runs the whole immediate list
- qtimers: `maxTickDepth = 10` runs 10 immediate calls at a time
- qtimers hybrid: `maxTickDepth = -10` runs the whole immediate list + 10 additional calls

QTimers has just one immediate list.  A call to setImmediate from inside an
immediate function will append to same list currently being processed.  If the
configured maxTickDepth is greater than length of the queue, the loop will run
some callbacks added during the loop, too.  Running just-queued callbacks can
greatly speed up some usage patterns, e.g. tail-recursive setImmediate.  A
`maxTickDepth = 10` is 9 x faster than nodejs v0.10; ` = 100` is 16x faster.

The nodejs v0.10 spec (Stability: 5, Locked) requires maxTickDepth to be 1, ie
run only one setImmediate call per loop.  With maxTickDepth = 1, a QTimers
setImmediate loop is still 85% faster than node-v0.10.29.

The nodejs v0.12 spec (Stability: 5, Locked) requires maxTickDepth to be 0,
the length of the immediate list, ie run only the already queued immediate
calls and no more.

Apparently "5, Locked" is not sufficient for the semantics not to change.
Configure QTimers to to match a flavor of the spec, or tune it for speed.

### uninstall( )

When loaded, qtimers install themselves to replace the built-in timers
functions.  This can be un-done with `uninstall()`.  It is safe to call
`uninstall` more than once.

### install( )

Explicit call to install (or reinstall) qtimers as the timers package to use.
It is safe to call `install` more than once.

### currentTimestamp( )

returns the millisecond timestamp that setTimeout uses internally.  This is a
scheduling timestamp and not the current time of day, but unless there are lot
of long-running blocking computations, the two should be the same.

The timestamp is updated by an event timer every millisecond at the beginning
and end of each timeout interval.  Each timeout function in that interval will
see the same timestamp; setImmediate functions will see the timestamp set at
the end of the last timeout interval.

Normally the timestamp will stay in sync with Date.now(), but long-running
blocking functions could introduce a lag.  The timestamp is updated every
millisecond while there is active work to do, and every 10 milliseconds when
only unreferenced timers are left.


TODO
----

- refactor into a singleton for better testability
- tune setTimeout
- track down why node-v0.12 is slower than v0.10.29
- allow sub-millisecond resolution timeouts and intervals (1/10 ms, say)
- maybe rename currentTimestamp() to getTimeoutTimestamp() ?
- qtimers uses 0.75% cpu at idle (vm), see if can be reduced (create
  interval threads on demand maybe?)  .0075 * 1e6 timer thread creations /
  sec is 7500/sec, but need just 1 per ms
