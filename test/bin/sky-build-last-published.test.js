var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , spawn = require('win-fork')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky
  , next = require('nextflow')


var TEST_DIR = ''

describe('bin/', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    TEST_DIR = path.join(TEST_DIR, 'build')
    if (!fs.existsSync(TEST_DIR)) fs.mkdirsSync(TEST_DIR)
    process.chdir(TEST_DIR)
  })

  describe('sky-build last build', function() {
    it('should build the files that were changed after last build', function(done) {
      var title1 = 'Global Thermal Nuclear Warfare'
        , tags1 = ['war', 'politics']
        , title2 = 'Slavery in the Contemporary Era'
        , tags2 = ['politics', 'slavery']
        , markdownArticles = []
        , mtimes = []

      var flow;
      next(flow = {
        ERROR: function(err) {
          done(err)
        },
        createNew: function() {
          runSky('new', '-r', 'personal-blog', 'myblog-lastBuild', flow.next)
        },
        setupNewTestDir: function(code) {
          EQ (code, 0) //sky-new ran alright
          TEST_DIR = path.join(TEST_DIR, 'myblog-lastBuild')
          fs.mkdirsSync(TEST_DIR)
          process.chdir(TEST_DIR)

          flow.next()
        },
        createSomeArticles: function() {
          runSky('article', title1, '--tags', tags1.join(','), function(code, stdout, stderr) {
            EQ (code, 0)
            var file = stdout.replace('created.', '').trim()
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('publish: ', 'publish: ' + getDate()))
            fs.appendFileSync(file, '\n**Preface:**\nBlah blah')
            markdownArticles.push(file)
            runSky('article', title2, '--tags', tags2.join(','), function(code, stdout, stderr) {
              EQ (code, 0)
              var file = stdout.replace('created.', '').trim()
              fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('publish: ', 'publish: ' + getDate()))
              fs.appendFileSync(file, '\n**Preface:**\nBlah blah')
              markdownArticles.push(file)
              flow.next()
            })
          })
        },
        runBuild: function() {
          runSky('build', function(code, stdout, stderr) {
            EQ (stderr, '')
            EQ (code, 0)
            flow.next()
          })
        },
        verify: function() {
          /*var now = new Date()

          var configFile = path.join(TEST_DIR, 'sky', 'config.json')
          T (fs.existsSync(configFile))
          var configJson = fs.readJsonSync(configFile)
          configJson.blog.lastBuild = now.toISOString()

          mtimes.push()*/


          done()
        }
      })
    })
  })
})

function getDate () {
  var d = new Date()
  return d.getFullYear() + '-' + ('0' + (d.getMonth()+1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
}


