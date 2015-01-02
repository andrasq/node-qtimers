module.exports = {
    'package.json should parse': function(t) {
        t.expect(1);
        var json = require('../package.json');
        t.equal('qtimers', json.name);
        t.done();
    },
};
