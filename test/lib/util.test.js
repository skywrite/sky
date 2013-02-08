var testutil = require('testutil')
  , P = require('autoresolve')
  , util = require(P('lib/util'))


describe('util', function() {
  describe('+ template(string, data)', function() {
    it('should populate the template values', function() {
      var s = "Hello {{name}}! How are you doing during the year of {{date-year}}?"
      var data = {name: 'JP', 'date-year': 2013}
      EQ (util.template(s, data), 'Hello JP! How are you doing during the year of 2013?')
    })
  })
})