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

  describe('sky-build', function() {
    it('should build the site', function(done) {
      var title1 = 'Global Thermal Nuclear Warfare'
        , tags1 = ['war', 'politics']
        , title2 = 'Slavery in the Contemporary Era'
        , tags2 = ['politics', 'slavery']
        , markdownArticles = []

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
            EQ (code, 0)
            EQ (stderr, '')
            flow.next()
          })
        },
        verify: function() {
          T (fs.existsSync(path.join(TEST_DIR, 'public', 'index.html')))

          var a1 = path.basename(markdownArticles.shift(), '.md')
          a1 = path.join(TEST_DIR, 'public', a1 + '.html')
          console.log(a1)
          var a2 = path.basename(markdownArticles.shift(), '.md')
          a2 = path.join(TEST_DIR, 'public', a2 + '.html')

          T (fs.existsSync(a1))
          T (fs.existsSync(a2))

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


