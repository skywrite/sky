var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky


var TEST_DIR = ''

describe('bin/', function() {
  var title = 'Global Thermal Nuclear War'
    , tags = ['war', 'politics']

  beforeEach(function () {
    TEST_DIR = testutil.createTestDir('sky')
    TEST_DIR = path.join(TEST_DIR, 'new')
    if (!fs.existsSync(TEST_DIR)) fs.mkdirsSync(TEST_DIR)
    process.chdir(TEST_DIR)
  })

  describe('sky-new', function() {
    describe('> when the rock is just a valid name for a repo on skywrite', function() {
      it('should download the proper rock from skywrite github', function(done) {
        process.chdir(TEST_DIR)
        runSky('new', '-r', 'personal-blog', 'myblog', function(code, stdout, stderr) {
          VERIFY_NEW_WORKED(code, stdout, stderr, done)
        })  
      })
    })

    describe('> when the rock is just a valid name for a repo', function() {
      it('should download the proper rock from the  repo', function(done) {
        process.chdir(TEST_DIR)
        runSky('new', '-r', 'skywrite/rock-personal-blog', 'myblog', function(code, stdout, stderr) {
          VERIFY_NEW_WORKED(code, stdout, stderr, done)
        })  
      })
    })

    describe('> when the rock is just a valid local directory', function() {
      it('should copy the rock to the specified destination', function(done) {
        process.chdir(TEST_DIR)
        runSky('new', '-r', P('test/resources/faux-rock'), 'myblog', function(code, stdout, stderr) {
          VERIFY_NEW_WORKED(code, stdout, stderr, done)
        })  
      })
    })
  })
})

function VERIFY_NEW_WORKED (code, stdout, stderr, done) {
  EQ (code, 0)

  T (fs.existsSync(path.join(TEST_DIR, 'myblog', 'articles')))
  T (fs.existsSync(path.join(TEST_DIR, 'myblog', 'pages')))
  T (fs.existsSync(path.join(TEST_DIR, 'myblog', 'sky')))

  //make sure .gitkeep files are deleted
  F (fs.existsSync(path.join(TEST_DIR, 'myblog', 'pages', '.gitkeep')))

  done()
}

