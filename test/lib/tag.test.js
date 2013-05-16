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

  describe('+ tagCount(counts, arr)', function() {
    it('should keep a persistent count of tags', function() {
      var counts = {}
      
      tag.tagCount(counts, ['java', 'ruby'])
      EQ (counts['java'], 1)
      EQ (counts['ruby'], 1)
      EQ (Object.keys(counts).length, 2)

      tag.tagCount(counts, ['javascript', 'c', 'java'])
      EQ (counts['java'], 2)
      EQ (counts['ruby'], 1)
      EQ (counts['c'], 1)
      EQ (counts['javascript'], 1)
      EQ (Object.keys(counts).length, 4)
    })
  })
})