qtimers
=======

a fast drop-in replacement for `require('timers')` with support for
setImmediate, setTimeout, etc.

QTimers uses faster internal data structures than the builtin nodejs
timers.js, and (optionally) relaxes some nodejs limitations.  The speedups are
from a combination of

- circular buffer for immediate tasks, not a linked list
- allow better optimization (not passing `arguments` to array.slice)
- special-case single-argument callbacks
- allow multiple immediate calls before checking event loop
- reuse timestamps as much as possible


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
        // maxTickDepth = 10:  .20 sec
        // node-v0.10.29:     1.78 sec

Loop a million times, less quickly:

        require('qtimers');
        setImmediate.maxTickDepth = 1;
        function loop(nleft) { if (--nleft > 0) setImmediate(loop, nleft); }
        loop(1000000);
        // maxTickDepth = 100: 0.42 sec
        // maxTickDepth = 10:  0.50 sec
        // maxTickDepth = 1:   1.3  sec

Loop a million times, slowly:

        function loop(nleft) { if (--nleft > 0) setImmediate(loop, nleft); }
        loop(1000000);
        // node-v0.10.29:     14.4  sec


Api
---

QTimers supports all the calls exposed by the node built-in.

### setImmediate( fn, [arg1, ...] )

Arrange for fn() to be called with the provided arguments after the current
thread exits.  Returns an opaque immediateObject that can be used to cancel
the call.  SetImmediate functions are run in the order added.  Up to
`setImmediate.maxTickDepth` functions are run before checking the event loop
(default 10, though the nodejs spec requires 1).

### clearImmediate( immediateObject )

Cancel the immediate callback.

### timeout = setTimeout( fn, ms, [arg1, ...])

Arrange for fn() to be called after a delay of `ms`.  Returns a timeoutObject.

### clearTimeout( timeoutObject )

Cancel the timeout callback.

### interval = setInterval( fn, ms, [arg1, ...])

Arrange for fn() to be called after a delay of `ms` and every `ms` thereafter.
Returns an intervalObject.

### clearInterval( intervalObject )

Cancel the interval callback.


The opaque timer objects returned by setTimeout and setInterval have a method
`unref()`.  Calling unref will prevent that timer from keeping the program
running if there are no other events left pending.  Ref will undo an unref.

### timeoutObject.unref( ), intervalObject.unref( )

Do not prevent the program from exiting just because of this timer.

### timeoutObject.ref( ), intervalObject.ref( )

Disable unref, do not exit the program as long as this timer is active.
Timeout timers deactivate when run; interval timers remain active until
canceled.


In addition, QTimers allows adjusting the min and max timeout value.

### setTimeout.MIN_TIMEOUT = 1

The shortest permitted timeout for setTimeout and setInterval functions, in
milliseconds.  Default 1.  Note that setting MIN_TIMEOUT to 0 is not the same
as using setImmediate:  timeouts occur once a millisecond, so the function
will get called after a delay of as much as 1ms.

### setTimeout.MAX_TIMEOUT = (2**31 - 1)

The longest permitted timeout for setTimeout and setInterval, in milliseconds.
Default (2 ^ 31) - 1, is the largest twos-complement positive 32-bit integer.
Note that setting MAX_TIMEOUT low is not the same as capping the delay:  if
the timeout delay is outside the valid range, a delay of 1 ms is used instead.

### setImmediate.maxTickDepth = 10

The number of immediate functions to call before returning to the event loop.
The nodejs spec requires this to be 1, ie only one setImmediate call handled
between checks of the event loop.  With it set to 1, QTimers setImmediate runs
90% faster than node-v0.10.29.

However, many setImmediate calls are very short, and are strongly penalized by
the spec.  The QTimer default is 10, which results in a large performance
boost, up to 9x faster than nodejs; at 100 13x faster.

<!--
Note that setting this value too low (or to 1) is a false optimization, since
nodejs runs all setTimeout timers that expire together in one bunch without
checking the event loop between calls.  Calling multiple setImmediate
functions is no worse than having multiple timers time out together.
-->


TODO
----

- refactor into a singleton for testability
- unit tests
