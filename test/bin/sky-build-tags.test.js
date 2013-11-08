'use strict'

var testutil = require('testutil')
  , shell = testutil.shell
  , P = require('autoresolve')
  , path = require('path')
  , fs = require('fs-extra')
  , S = require('string')
  , testsky = require(P('test/test-lib/testsky')) 
  , readText = testsky.readText
  , runSkySync = testsky.runSkySync
  , dquote = testsky.dquote
  , stripcolors = testsky.stripcolors

var TEST_DIR = ''

describe('bin/', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    shell.cd(TEST_DIR)
  })

  describe('sky-build-tags', function() {
    it('description', function() {
      var title1 = 'Global Thermal Nuclear Warfare'
      var tags1 = ['War', 'Politics']
      var title2 = 'Slavery in the Contemporary Era'
      var tags2 = ['Politics', 'Slavery']

      var res = runSkySync('new', '-r', 'personal-blog', 'myblog')
      EQ (res.code, 0)

      TEST_DIR = path.join(TEST_DIR, 'myblog')
      T (fs.existsSync(TEST_DIR))

      shell.cd(TEST_DIR)

      res = runSkySync('article', dquote(title1), '--tags', tags1.join(','))
      var article1File = res.output.split(' ')[0]
      EQ (res.code, 0)
            
      res = runSkySync('article', dquote(title2), '--tags', tags2.join(','))
      var article2File = res.output.split(' ')[0]
      EQ (res.code, 0)

      res = runSkySync('build-tags')
      EQ (res.code, 0)

      res.output = stripcolors(res.output)

      T (S(res.output).contains('Politics : 2'))
      T (S(res.output).contains('Slavery : 1'))
      T (S(res.output).contains('War : 1'))

      var tagsDir = path.join(TEST_DIR, 'public', 'tags')
      T (fs.existsSync(tagsDir))

      var politicsFile = path.join(tagsDir, 'politics')
      var slaveryFile = path.join(tagsDir, 'slavery')
      var warFile = path.join(tagsDir, 'war')

      T (fs.existsSync(politicsFile))
      T (fs.existsSync(slaveryFile))
      T (fs.existsSync(warFile))

      //check that articles are linked in tag files
      T (S(readText(politicsFile)).contains(title1))
      T (S(readText(politicsFile)).contains(title2))

      F (S(readText(slaveryFile)).contains(title1))
      T (S(readText(slaveryFile)).contains(title2))

      T (S(readText(warFile)).contains(title1))
      F (S(readText(warFile)).contains(title2))

    })
  })
})