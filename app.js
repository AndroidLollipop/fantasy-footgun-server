// const { Client } = require("pg");
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

/*const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

client.connect()*/

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

const fs = require('fs')
var state = JSON.parse(fs.readFileSync("./defaultData/state.json"))
const notificationsString = fs.readFileSync("./defaultData/notificationsStore.json")
const submissionsStrings = fs.readFileSync("./defaultData/submissions.json")
var notificationsStore = JSON.parse(notificationsString)
var submissionsStore = JSON.parse(submissionsStrings)
var dataStore
rerenderData()

const sha256hash = content => crypto.createHash('sha256').update(content).digest('base64')
const AUTH_SECRET = process.env.AUTH_SECRET
const readCurToken = () => {
  return sha256hash(`${AUTH_SECRET}::${state.tokenNum}`)
}
const incrementToken = () => {
  state.tokenNum++
  fs.writeFile("./defaultData/state.json", JSON.stringify(state), ()=>{})
}
const freshToken = () => {
  incrementToken()
  return readCurToken()
}

/*client.query("SELECT my_data FROM mydata WHERE my_key='uid';", (err, res) => {
  if (err) throw err;
  for (let row of res.rows) {
    console.log(internalUID)
    internalUID = row["my_data"];
    console.log(internalUID)
  }
});*/

/*client.query("SELECT my_data FROM mydata WHERE my_key='indents';", (err, res) => {
  if (err) throw err;
  for (let row of res.rows) {
    console.log(dataStore)
    dataStore = row["my_data"];
    console.log(dataStore)
    notifyI()
  }
});*/

/*client.query("SELECT my_data FROM mydata WHERE my_key='notifications';", (err, res) => {
  if (err) throw err;
  for (let row of res.rows) {
    console.log(notificationsStore)
    notificationsStore = row["my_data"];
    console.log(notificationsStore)
    notifyN()
  }
});*/

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

const appendSubmission = (submission) => {
  submissionsStore = [...submissionsStore, submission]
  fs.writeFile("./defaultData/submissions.json", JSON.stringify(submissionsStore), ()=>{})
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