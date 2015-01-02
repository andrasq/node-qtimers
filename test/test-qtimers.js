var timers = require('../index');
timers.install();

module.exports = {
    'package.json should parse': function(t) {
        t.expect(1);
        var json = require('../package.json');
        t.equal('qtimers', json.name);
        t.done();
    },

    'setImmediate': {
        'should return immediateObject': function(t) {
            t.equal('object', typeof(setImmediate(function(){})));
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
            var im = setImmediate(function(){ throw new Error("should not get called") });
            clearImmediate(im);
            t.expect(1);
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

        'should invoke 10000 callbacks': function(t) {
            var i, ncalls = 10000;
            t.expect(1);
            for (i=0; i<ncalls; i++) setImmediate(function() { --ncalls; if (ncalls === 0) { t.ok(1); t.done(); } });
        }
    },
};
