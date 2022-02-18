const { Client } = require("pg");
const express = require("express");
const http = require("http");
const crypto = require("crypto")

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
    resolve(res.rows[0])
  })
  return myPromise
}

const fs = require('fs')
var state
var notificationsStore
var submissionsStore

const init = Promise.all([
  (async () => state=JSON.parse(await readDBKey("state")))(),
  (async () => notificationsStore=JSON.parse(await readDBKey("notifications")))(),
  (async () => submissionsStore=JSON.parse(await readDBKey("submissions")))()
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

  const rerenderData = cb => {
    dataStore = renderSubmissions(submissionsStore, state.scoreRows === true ? row => {
      scores = notificationsStore.map(category => category.winner === row[category.name] ? 1 : 0)
      return [row.nickname, scores.reduce((a, b) => a+b), ...scores]
    } : row => [row.nickname, "", "", "", ""])
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
      origin: "http://localho.st:3000",
      methods: ["GET", "POST"]
    }
  });

  var sockets = []

  io.on("connection", (socket) => {
    sockets.push(socket)
    console.log("New client connected");
    const interval = setInterval(() => getApiAndEmit(socket), 20000);
    socket.on("disconnect", () => {
      sockets = sockets.filter(s => s !== socket)
      console.log("Client disconnected");
      clearInterval(interval);
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
      const [authenticated, exists] = authenticate(submission, authToken)
      if (!authenticated) {
        socket.emit("fail", "Somebody has already chosen this name. Please choose a different name.", writeToken)
        return
      }
      const commitAuthToken = !authToken ? freshToken() : authToken
      const newSub = {...submission, authToken: commitAuthToken, dateSubmitted: JSON.stringify(new Date())}
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

  const getApiAndEmit = socket => {
    const response = new Date();
    // Emitting a new message. Will be consumed by the client
    socket.emit("FromAPI", response);
  };

  server.listen(port, () => console.log(`Listening on port ${port}`));
})()