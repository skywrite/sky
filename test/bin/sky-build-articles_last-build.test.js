var testutil = require('testutil')
  , fs = require('fs-extra')
  , path = require('path')
  , P = require('autoresolve')
  , spawn = require('win-spawn')
  , MarkdownPage = require('markdown-page').MarkdownPage
  , S = require('string')
  , runSky = require(P('test/test-lib/testsky')).runSky
  , next = require('nextflow')
  , SkyEnv = require('sky-env').SkyEnv


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
        , md1 = '' , md2 = '', o1 = '', o2 = '', t1 = -1, t2 = -2
        , lastBuildTime = null
        , skyEnv = null

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

          skyEnv = new SkyEnv(TEST_DIR)
          skyEnv.loadConfigsSync()

          flow.next()
        },
        createSomeArticles: function() {
          runSky('article', title1, '--tags', tags1.join(','), function(code, stdout, stderr) {
            EQ (code, 0)
            var file = stdout.replace('created.', '').trim()
            //fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('publish: ', 'publish: ' + getDate()))
            fs.appendFileSync(file, '\n**Preface:**\nBlah blah')
            md1 = file
            runSky('article', title2, '--tags', tags2.join(','), function(code, stdout, stderr) {
              EQ (code, 0)
              var file = stdout.replace('created.', '').trim()
              //fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('publish: ', 'publish: ' + getDate()))
              fs.appendFileSync(file, '\n**Preface:**\nBlah blah')
              md2 = file
              flow.next()
            })
          })
        },
        runBuild: function() {
          runSky('build-articles', function(code, stdout, stderr) {
            EQ (stderr, '')
            EQ (code, 0)
            skyEnv.loadConfigsSync()
            flow.next()
          })
        },
        verify: function() {
          o1 = skyEnv.mdArticleToOutputFileWithPath(md1)
          o2 = skyEnv.mdArticleToOutputFileWithPath(md2)

          T (fs.existsSync(o1))
          T (fs.existsSync(o2))
          
          t1 = fs.lstatSync(o1).mtime
          t2 = fs.lstatSync(o2).mtime
          
          lastBuildTime = new Date(skyEnv.configs.get('config:build.lastBuild'))

          setTimeout(flow.next, 1000)
        },
        modifyFile: function() {
          fs.appendFileSync(md1, '\n\n more text') //modify first file

          flow.next()
        },
        runBuildAgain: function() {
          runSky('build-articles', function(code, stdout, stderr) {
            EQ (stderr, '')
            EQ (code, 0)

            skyEnv.loadConfigsSync()

            //verify only modified file is in output
            T (S(stdout).contains(title1))
            F (S(stdout).contains(title2))

            flow.next()
          })
        },
        verifyAgain: function() {
          var nt1 = fs.lstatSync(o1).mtime
            , nt2 = fs.lstatSync(o2).mtime
            , newLastBuildTime = new Date(skyEnv.configs.get('config:build.lastBuild'))

          T (nt1.getTime() > t1.getTime())
          T (nt2.getTime() === t2.getTime()) //output file not modified
          T (newLastBuildTime.getTime() > lastBuildTime.getTime())

          flow.next()
        },
        verifyThatIndexBuiltPropery: function() {
          var indexFile = path.join(TEST_DIR, 'public', 'index.html')
          T (fs.existsSync(indexFile))

          var indexContents = fs.readFileSync(indexFile, 'utf8')

          T (S(indexContents).contains(title1))
          T (S(indexContents).contains(title2)) //<--- regression bug here

          done() 
        }
      })
    })
  })
})

function getDate () { //todo: delete this in place of sutil.datefmt
  var d = new Date()
  return d.getFullYear() + '-' + ('0' + (d.getMonth()+1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
}


