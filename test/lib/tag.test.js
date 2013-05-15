var testutil = require('testutil')
  , P = require('autoresolve')
  , tag = require(P('lib/tag'))

describe('tag', function() {
  describe('+ maxTagLen(arr)', function() {
    describe('> when input is an array of strings', function() {
      it('should return the longest tag', function() {
        var arr = ['c', 'javascript', 'ruby']
        EQ (tag.maxTagLen(arr), 'javascript'.length)
      })
    })

    describe('> when input is an array of single key/val objects', function() {
      it('should return the longest tag', function() {
        var arr = [
          {'c': 5},
          {'javascript': 15},
          {'ruby': 2}
        ]

        EQ (tag.maxTagLen(arr), 'javascript'.length)
      })
    })
  })
})