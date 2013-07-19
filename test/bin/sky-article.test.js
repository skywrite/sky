var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , spawn = require('win-spawn')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky


var TEST_DIR = ''

describe('bin/', function() {
  var title = 'Global Thermal Nuclear War'
    , tags = ['war', 'politics']

  beforeEach(function () {
    TEST_DIR = testutil.createTestDir('sky')
    TEST_DIR = path.join(TEST_DIR, 'article')
    if (!fs.existsSync(TEST_DIR)) fs.mkdirsSync(TEST_DIR)
    process.chdir(TEST_DIR)
  })

  describe('sky-article', function() {
    describe('> when article title and tags specified', function() {
      it('should create the article file with the proper slug including the title and tags', function(done) {
        runSky('article', title, '--tags', tags.join(','), function(code, stdout, stderr) {
          EQ (code, 0)
          var filePath = stdout.replace('created.', '').trim()
          var mdp = MarkdownPage.create(fs.readFileSync(filePath, 'utf8').trim())
          mdp.parse(function(err) {
            F (err)
            EQ (mdp.metadata.title, title)
            EQ (mdp.metadata.tags.join(','), tags.join(','))
            done()
          })
        })
      })
    })

    describe('> when article title and one tag is specified', function() {
      it('should create the article file with the proper slug including the title and tag', function(done) {
        runSky('article', title, '--tags', "war", function(code, stdout, stderr) {
          EQ (code, 0)
          var filePath = stdout.replace('created.', '').trim()
          var mdp = MarkdownPage.create(fs.readFileSync(filePath, 'utf8').trim())
          mdp.parse(function(err) {
            F (err)
            EQ (mdp.metadata.title, title)
            EQ (mdp.metadata.tags[0], "war")
            done()
          })
        })
      })
    })

    describe('> when only article title specified', function() {
      it('should create the article file with the proper slug including the title', function(done) {
        runSky('article', title, function(code, stdout, stderr) {
          EQ (code, 0)
          var filePath = stdout.replace('created.', '').trim()
          var mdp = MarkdownPage.create(fs.readFileSync(filePath, 'utf8').trim())
          mdp.parse(function(err) {
            F (err)
            EQ (mdp.metadata.title, title)
            F (mdp.metadata.tags)
            done()
          })
        })
      })
    })

    describe('> when no article title is specified', function() {
      it('should create a file with a generic name', function(done) {
        runSky('article', function(code, stdout, stderr) {
          EQ (code, 0)
          var filePath = stdout.replace('created.', '').trim()
          var mdp = MarkdownPage.create(fs.readFileSync(filePath, 'utf8').trim())
          mdp.parse(function(err) {
            F (err)
            T (mdp.metadata.title.length > 0)
            T (mdp.markdown.length > 0)
            done()
          })
        })
      })
    })
  })
})

