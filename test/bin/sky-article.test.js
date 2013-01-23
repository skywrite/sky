var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , spawn = require('win-fork')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  //, spawn = require('child_process').spawn


var TEST_DIR = ''
  , SKY_BIN = P('bin/sky')

function runSky () {
  var args = Array.prototype.slice.call(arguments, 0)
    , stdout = ''
    , stderr = ''
    , callback = args[args.length-1]

  args.splice(args.length - 1, 1) //cut callback

  var sky = spawn(SKY_BIN, args)
  sky.stdout.on('data', function(data) {
    stdout += data.toString()
  }) 
  sky.stderr.on('data', function(data) {
    stderr += stderr.toString()
  })
  sky.on('exit', function(code) {
    callback(code, stdout, stderr)
  })
}

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
            EQ (mdp.title, title)
            EQ (mdp.metadata.tags.join(','), tags.join(','))
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
            EQ (mdp.title, title)
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
            T (mdp.title.length > 0)
            T (mdp.markdown.length > 0)
            done()
          })
        })
      })
    })
  })
})

