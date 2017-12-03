const GitHub = require('github-api')
const config = require('./config/development.json')
const _ = require('lodash')
const async = require('async')
const decrypt = require('./dict-cypher').decryptDictEntry

const LIMIT_SIMULTANEOUS_REQS_LIST_FILES = 10
const LIMIT_SIMULTANEOUS_PR_ACCEPTS = 1

const gh = new GitHub(config.auth)
const repo = gh.getRepo(config.repo.user, config.repo.name)
const encryptedDict = require('./' + config.encryptedDict)
// get available PRs
repo.listPullRequests().then(PRs => {
  return PRs.data.map(PR => {
    return {
      user: PR.user.login,
      url: PR.url,
      number: PR.number
    }
  })
})
//check files and decide to accept or reject PRs
.then(PRs => {
  return new Promise((resolve) => {
    async.mapLimit(PRs, LIMIT_SIMULTANEOUS_REQS_LIST_FILES, (PR, cb)=> {
      return repo.listPullRequestFiles(PR.number)
        .then(files => {
          return files.data.map(f => {return {filename:f.filename, status: f.status}})
        })
        .then(files => {
          PR.files = files
          PR.accept = checkUserAndFiles(PR.user, files)
          cb(null, PR)
        })
    }, (err, PRs) => resolve(PRs))
  })
})
//accept or reject PRs
.then(PRs => {
  async.series([
    (cb) => {
      console.log("Accepting", PRs.filter(PR => PR.accept).length, 'Pull Requests.')
      async.mapLimit(
        PRs.filter(PR => PR.accept),
        LIMIT_SIMULTANEOUS_PR_ACCEPTS,
        (PR, cb) => repo.mergePullRequest(PR.number, {}, cb),
        cb
      )
    },
    (cb) => {
      console.log("Closing", PRs.filter(PR => !PR.accept).length, 'Pull Requests.')
      async.mapLimit(
        PRs.filter(PR => !PR.accept),
        LIMIT_SIMULTANEOUS_PR_ACCEPTS,
        (PR, cb) => repo.updatePullRequest(PR.number, {state: 'close'},cb),
        cb
      )
    }
  ], (err, res) => {console.log(err || '', 'Done!')})
})

function checkUserAndFiles(user, files){
  try{
    const possibleFiles = decrypt(encryptedDict, user)
    if(files.filter(f => f.status === 'delete') > 0) return false
    if(files.length !== _.intersection(files.map(f => f.filename), possibleFiles).length) return false
    return true
  }
  catch(e){
    console.log('User', user, 'trying to modify files', JSON.stringify(files), 'not found.')
    return false
  }
}
