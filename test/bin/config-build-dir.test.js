var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , spawn = require('win-spawn')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky
  , next = require('nextflow')


var TEST_DIR = ''

describe('config', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    TEST_DIR = path.join(TEST_DIR, 'config')
    if (!fs.existsSync(TEST_DIR)) fs.mkdirsSync(TEST_DIR)
    process.chdir(TEST_DIR)
  })

  describe('> when build output dir changes', function() {
    it('sky-build should build the site and output the contents to the proper location', function(done) {
      var title1 = 'Global Thermal Nuclear Warfare'
        , tags1 = ['war', 'politics']
        , articleFile = ''

      var flow;
      next(flow = {
        ERROR: function(err) {
          done(err)
        },
        createNew: function() {
          runSky('new', '-r', 'personal-blog', 'myblog', flow.next)
        },
        setupNewTestDir: function(code) {
          EQ (code, 0) //sky-new ran alright
          TEST_DIR = path.join(TEST_DIR, 'myblog')
          fs.mkdirsSync(TEST_DIR)
          process.chdir(TEST_DIR)

          flow.next()
        },
        editConfig: function() {
          var cfgFile = path.join(TEST_DIR, 'sky', 'config.json')
          var cfg = fs.readJsonSync(cfgFile)
          if (!cfg.build) cfg.build = {}
          cfg.build.outputDir = 'boo/'
          fs.writeJsonSync(cfgFile, cfg)
          flow.next()
        },
        createSomeArticles: function() {
          runSky('article', title1, '--tags', tags1.join(','), function(code, stdout, stderr) {
            EQ (code, 0)
            articleFile = stdout.replace('created.', '').trim()
            //fs.writeFileSync(articleFile, fs.readFileSync(articleFile, 'utf8').replace('publish: ', 'publish: ' + getDate()))
            fs.appendFileSync(articleFile, '\n**Preface:**\nBlah blah')
            flow.next()
          })
        },
        runBuild: function() {
          runSky('build-articles', function(code, stdout, stderr) {
            EQ (stderr, '')
            EQ (code, 0)
            flow.next()
          })
        },
        verify: function() {
          var indexFile = path.join(TEST_DIR, 'boo', 'index.html')
          T (fs.existsSync(indexFile))

          var a1 = path.basename(articleFile, '.md')
          a1 = path.join(TEST_DIR, 'boo', a1 + '.html')
         
          T (fs.existsSync(a1))

          //verify content got produced
          T (fs.readFileSync(a1, 'utf8').indexOf('<strong>Preface') > 0)

          //verify content in index page was created
          T (fs.readFileSync(indexFile, 'utf8').indexOf(title1) > 0)

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


