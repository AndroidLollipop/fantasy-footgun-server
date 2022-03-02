const { Client } = require("pg");
const express = require("express");
const http = require("http");
const crypto = require("crypto")
const shapeValidator = require("./validation/shapeValidator")
const shapes = require("./validation/shapes");
const validateType = require("./validation/shapeValidator");
const submissionModel = require("./dataModels/submissionModel");
const rerenderThrottle = 500;

const postgresSafe = x => {
  var ret = ""
  for (char of x) {
    if (char === "'"){
      ret += "''"
    }
    else {
      ret += char
    }
  }
  return ret
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

client.connect()

const readDBKey = (key) => {
  var resolve
  var reject
  const myPromise = new Promise((res, rej) => (resolve=res,reject=rej))
  client.query(`SELECT my_data FROM mydata WHERE my_key='${postgresSafe(key)}';`, (err, res) => {
    if (err) {
      reject(err);
      return
    }
    if (!res) {
      reject("Empty response")
      return
    }
    if (res.rows.length !== 1) {
      reject(`Error: ${res.rows.length} rows found`)
      return
    }
    resolve(res.rows[0]["my_data"])
  })
  return myPromise
}

var state
var notificationsStore
var submissionsStore

const init = Promise.all([
  (async () => submissionsStore=await readDBKey("submissions"))(),
  (async () => notificationsStore=await readDBKey("notifications"))(),
  (async () => state=await readDBKey("state"))()
]);

(async () => {

  try {
    await init
  }
  catch(e) {
    console.log(e)
    return
  }

  const columns = submissionModel.columns
  const renderSubmissions = (submissionsStore, rowTransform, scoringMetric) => {
    const mySubmissions = [...submissionsStore]
    if (typeof scoringMetric === "function") {
      mySubmissions.sort(scoringMetric)
    }
    return {columns, rows: mySubmissions.map(rowTransform)}
  }

  const scores = row => {
    const scores = notificationsStore.map(category => category.winner === row[category.name] ? 1 : 0)
    return [scores.reduce((a, b) => a+b), ...scores]
  }

  var latestRenderActive = false
  var latestRender
  var registeredCbs = new Set()

  const rerenderData = async cb => {
    if (registeredCbs.has(cb)) {
      return
    }
    registeredCbs.add(cb)
    if (latestRenderActive) {
      await latestRender
      return typeof cb === "function" ? cb(dataStore) : undefined
    }
    latestRenderActive = true
    latestRender = new Promise((resolve) => {
      setTimeout(() => {
        latestRenderActive = false
        registeredCbs.clear()
        resolve()
      }, rerenderThrottle)
    })
    await latestRender
    return forceRerenderData(cb)
  }

  const forceRerenderData = cb => {
    var emptyRow
    if (state.scoreRows !== true) {
      emptyRow = ["", ...notificationsStore.map(x => "")]
    }
    dataStore = renderSubmissions(
      submissionsStore,
      state.scoreRows === true ? row => [row.nickname, ...scores(row)] : row => [row.nickname, ...emptyRow],
      state.scoreRows === true ? (row1, row2) => {
        const r1s = scores(row1)[0]
        const r2s = scores(row2)[0]
        if (r1s !== r2s) {
          return r2s-r1s
        }
        return row1.dateSubmitted-row2.dateSubmitted
      }: (row1, row2) => {
        return row2.dateSubmitted-row1.dateSubmitted
      }
    )
    if (typeof cb === "function") {
      return cb(dataStore)
    }
  }

  var dataStore
  rerenderData()

  const sha256hash = content => crypto.createHash('sha256').update(content).digest('base64')
  const AUTH_SECRET = process.env.AUTH_SECRET
  const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET
  const readCurToken = () => {
    return sha256hash(`${AUTH_SECRET}::${state.tokenNum}`)
  }
  const incrementToken = () => {
    state.tokenNum++
    overwriteST()
  }
  const freshToken = () => {
    incrementToken()
    return readCurToken()
  }

  const port = process.env.PORT || 4001;
  const index = require("./routes/index");

  const app = express();
  app.use(index);

  const server = http.createServer(app);

  const io = require("socket.io")(server, {
    cors: {
      origin: "https://androidlollipop.github.io",
      methods: ["GET", "POST"]
    }
  });

  var sockets = []

  const fields = submissionModel.fields
  const optionalFields = submissionModel.optionalFields

  const validateSubmission = (submission) => {
    if (typeof submission !== "object") {
      return false
    }
    var matches = 0
    for (const field of fields) {
      if (typeof submission[field] !== "string") {
        return false
      }
      matches++
    }
    for (const optionalField of optionalFields) {
      if (submission[optionalField] !== undefined) {
        if (typeof submission[optionalField] !== "string") {
          return false
        }
        matches++
      }
    }
    if (Object.keys(submission).length !== matches) {
      return false
    }
    return true
  }

  const notifyIAll = () => notifyI()

  io.on("connection", (socket) => {
    var SESSION_GENERATING_TOKEN
    var SESSION_ADMIN_TOKEN
    sockets.push(socket)
    console.log("New client connected");
    socket.on("disconnect", () => {
      sockets = sockets.filter(s => s !== socket)
      console.log("Client disconnected");
    });
    socket.on("requestIndents", () => {
      socket.emit("sendIndents", dataStore)
    })
    socket.on("requestNotifications", () => {
      socket.emit("sendNotifications", notificationsStore)
    })
    socket.on("appendSubmission", (submission, writeToken, authToken) => {
      if (!state.allowSubmissions) {
        socket.emit("fail", "Submissions are closed.", writeToken)
        return
      }
      if (!validateSubmission(submission)) {
        socket.emit("fail", "Your client is out of date. Please refresh the page.", writeToken)
        return
      }
      const [authenticated, exists] = authenticate(submission, authToken)
      if (!authenticated) {
        socket.emit("fail", "This name has already been chosen. Please choose a different name.", writeToken)
        return
      }
      const commitAuthToken = !authToken ? freshToken() : authToken
      const newSub = {...submission, authToken: commitAuthToken, dateSubmitted: (new Date()).getTime()}
      if (exists) {
        writeSubmission(newSub)
      }
      else {
        appendSubmission(newSub)
      }
      socket.emit("commit", writeToken, commitAuthToken)
      rerenderData(notifyIAll)
    })
    socket.on("requestEraseEpoch", () => {
      socket.emit("sendEraseEpoch", state.eraseEpoch)
    })
    socket.on("requestAdminSalt", () => {
      if (typeof SESSION_ADMIN_TOKEN === "string") {
        return
      }
      if (SESSION_GENERATING_TOKEN === true) {
        return
      }
      SESSION_GENERATING_TOKEN = true
      const array = new Uint32Array(16)
      crypto.randomFill(array, (err, buf) => {
        if (err) {
          SESSION_GENERATING_TOKEN = false
          throw err
        }
        const session_admin_salt = sha256hash(`${buf}`)
        SESSION_ADMIN_TOKEN = sha256hash(`${session_admin_salt}::${ADMIN_AUTH_SECRET}`)
        socket.emit("sendAdminSalt", session_admin_salt)
      })
    })
    socket.on("requestAdminAuth", (adminAuthToken) => {
      if (typeof SESSION_ADMIN_TOKEN !== "string" || SESSION_ADMIN_TOKEN !== adminAuthToken) {
        socket.emit("sendAuthFailed", "")
        return
      }
      socket.emit("sendAuthSuccessful", "")
    })
    socket.on("writeState", (adminAuthToken, newState) => {
      if (typeof SESSION_ADMIN_TOKEN !== "string" || SESSION_ADMIN_TOKEN !== adminAuthToken) {
        socket.emit("sendAuthFailed", "")
        return
      }
      if (!validateType(shapes.stateSubmission)(newState)) {
        return
      }
      const rerender = newState.scoreRows !== undefined && newState.scoreRows !== state.scoreRows
      writeState(newState)
      if (rerender) {
        rerenderData(notifyIAll)
      }
    })
    socket.on("writeNotifications", (adminAuthToken, newNotifications) => {
      if (typeof SESSION_ADMIN_TOKEN !== "string" || SESSION_ADMIN_TOKEN !== adminAuthToken) {
        socket.emit("sendAuthFailed", "")
        return
      }
      if (!validateType(shapes.notificationsSubmission)(newNotifications)) {
        return
      }
      writeNotifications(newNotifications)
      notifyN()
      if (state.scoreRows) {
        rerenderData(notifyIAll)
      }
    })
    socket.on("eraseSubmissions", (adminAuthToken) => {
      if (typeof SESSION_ADMIN_TOKEN !== "string" || SESSION_ADMIN_TOKEN !== adminAuthToken) {
        socket.emit("sendAuthFailed", "")
        return
      }
      eraseSubmissions()
      rerenderData(notifyIAll)
      notifyE()
    })
  });

  const authenticate = (submission, authToken) => {
    const match = submissionsStore.find(x => x.nickname === submission.nickname)
    if (!match) {
      return [true, false]
    }
    return [authToken === match.authToken, true]
  }

  const notifyI = (except) => {
    for (const socket of sockets) {
      if (socket !== except) {
        socket.emit("sendIndents", dataStore)
      }
    }
  }

  const notifyN = (except) => {
    for (const socket of sockets) {
      if (socket !== except) {
        socket.emit("sendNotifications", notificationsStore)
      }
    }
  }

  const notifyE = (except) => {
    for (const socket of sockets) {
      if (socket !== except) {
        socket.emit("sendEraseEpoch", state.eraseEpoch)
      }
    }
  }

  const overwriteSS = () => {
    const submissionsJSON = JSON.stringify(submissionsStore)
    client.query("UPDATE mydata SET my_data = '"+postgresSafe(submissionsJSON)+"' WHERE my_key='submissions'", (err, res) => {
      if (err) throw err;
    })
  }

  const overwriteNS = () => {
    const notificationsJSON = JSON.stringify(notificationsStore)
    client.query("UPDATE mydata SET my_data = '"+postgresSafe(notificationsJSON)+"' WHERE my_key='notifications'", (err, res) => {
      if (err) throw err;
    })
  }

  const overwriteST = () => {
    const stateJSON = JSON.stringify(state)
    client.query("UPDATE mydata SET my_data = '"+postgresSafe(stateJSON)+"' WHERE my_key='state'", (err, res) => {
      if (err) throw err;
    })
  }

  const appendSubmission = (submission) => {
    submissionsStore = [...submissionsStore, submission]
    overwriteSS()
  }

  const writeSubmission = (submission) => {
    submissionsStore = submissionsStore.filter(x => x.nickname !== submission.nickname)
    appendSubmission(submission)
  }

  const writeState = (newState) => {
    state = {...state}
    for (const key in newState) {
      state[key] = newState[key]
    }
    overwriteST()
  }

  const writeNotifications = (newNotifications) => {
    notificationsStore = [...notificationsStore]
    var kv = {}
    for (const newNotification of newNotifications) {
      kv[newNotification.name] = newNotification
    }
    for (var i = 0; i < notificationsStore.length; i++) {
      const name = notificationsStore[i].name
      if (kv[name] !== undefined) {
        notificationsStore[i] = kv[name]
      }
    }
    overwriteNS()
  }

  const eraseSubmissions = () => {
    if (submissionsStore.length > 0) {
      state.eraseEpoch++
      submissionsStore = []
      overwriteST()
      overwriteSS()
    }
  }

  server.listen(port, () => console.log(`Listening on port ${port}`));
})()