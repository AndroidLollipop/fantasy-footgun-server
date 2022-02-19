const { Client } = require("pg");
const express = require("express");
const http = require("http");
const crypto = require("crypto")
const shapeValidator = require("./validation/shapeValidator")
const shapes = require("./validation/shapes")

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

const fs = require('fs')
var state
var notificationsStore
var submissionsStore

const init = Promise.all([
  (async () => state=await readDBKey("state"))(),
  (async () => notificationsStore=await readDBKey("notifications"))(),
  (async () => submissionsStore=await readDBKey("submissions"))()
]);

(async () => {

  try {
    await init
  }
  catch(e) {
    console.log(e)
    return
  }

  const columns = ["Name","Total Score","SAR21","SAW","GPMG"]
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

  const rerenderData = cb => {
    dataStore = renderSubmissions(
      submissionsStore,
      state.scoreRows === true ? row => [row.nickname, ...scores(row)] : row => [row.nickname, "", "", "", ""],
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
      cb(dataStore)
    }
  }

  var dataStore
  rerenderData()

  const sha256hash = content => crypto.createHash('sha256').update(content).digest('base64')
  const AUTH_SECRET = process.env.AUTH_SECRET
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

  const fields = ["nickname", "sar21", "saw", "gpmg"]
  const optionalFields = ["authToken"]

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

  io.on("connection", (socket) => {
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
      rerenderData(() => {
        notifyI()
      })
    })
    socket.on("requestEraseEpoch", () => {
      socket.emit("sendEraseEpoch", state.eraseEpoch)
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
    for (socket of sockets) {
      if (socket !== except) {
        socket.emit("sendIndents", dataStore)
      }
    }
  }

  const overwriteSS = () => {
    const submissionsJSON = JSON.stringify(submissionsStore)
    client.query("UPDATE mydata SET my_data = '"+postgresSafe(submissionsJSON)+"' WHERE my_key='submissions'", (err, res) => {
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

  server.listen(port, () => console.log(`Listening on port ${port}`));
})()