// const { Client } = require("pg");
const express = require("express");
const http = require("http");

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

const fs = require('fs')
var internalUID = JSON.parse(fs.readFileSync("./defaultData/uid.json"))
const dataString = fs.readFileSync("./defaultData/dataStore.json")
const notificationsString = fs.readFileSync("./defaultData/notificationsStore.json")
var dataStore = JSON.parse(dataString)
var notificationsStore = JSON.parse(notificationsString)

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

const readDataStore = (internalUID) => {
  const result = dataStore.filter(x => x.internalUID === internalUID)
  if (result.length === 0) {
    return undefined
  }
  else {
    return result[0]
  }
}

const overwriteDS = () => {
  const dataJSON = JSON.stringify(dataStore)
  /*client.query("UPDATE mydata SET my_data = '"+postgresSafe(dataJSON)+"' WHERE my_key='indents'", (err, res) => {
    if (err) throw err;
  })*/
  fs.writeFile('./defaultData/dataStore.json', dataJSON, ()=>{})
}

const overwriteNS = () => {
  const notificationsJSON = JSON.stringify(notificationsStore)
  /*client.query("UPDATE mydata SET my_data = '"+postgresSafe(notificationsJSON)+"' WHERE my_key='notifications'", (err, res) => {
    if (err) throw err;
  })*/
  fs.writeFile('./defaultData/notificationsStore.json', notificationsJSON, ()=>{})
}

const overwriteUID = () => {
  /*client.query("UPDATE mydata SET my_data = '"+postgresSafe(JSON.stringify(internalUID))+"' WHERE my_key='uid'", (err, res) => {
    if (err) throw err;
  })*/
  fs.writeFile('./defaultData/uid.json', JSON.stringify(internalUID), ()=>{})
}

const writeDataStore = (internalUID, write) => {
  const index = dataStore.findIndex(x => x.internalUID === internalUID)
  var result = false
  if (index > -1 && index < dataStore.length) {
    dataStore = [...dataStore]
    //MOCK SERVER, REMOVE IN PRODUCTION
    result = acknowledgeEdit(write, dataStore[index])
    dataStore[index] = write
    overwriteDS()
  }
  return result
}

const appendDataStore = (write) => {
  const insert = {...write, status: "Pending", internalUID: internalUID}
  appendJSON(insert)
  dataStore = [...dataStore, insert]
  internalUID++
  overwriteUID()
  overwriteDS()
}

const appendNotifications = (write, title) => {
  appendNSON([write, title])
  notificationsStore = [...notificationsStore, write]
  overwriteNS()
}

const acknowledgeEdit = ({internalUID, status}, {internalUID: oldUID, status: oldStatus, name: title}) => {
  if (status !== oldStatus && internalUID === oldUID) {
    appendNotifications({title: "Indent \""+readDataStore(internalUID).name+"\" is now "+status, internalUID: internalUID}, title)
    notifyN()
    return true
  }
  return false
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
  socket.on("writeDataStore", ([internalUID, write, token]) => {
    try {
      const edited = writeDataStore(internalUID, write)
      socket.emit("sendIndents", dataStore, token)
      notifyI(socket)
    }
    catch (e) {
      console.log(e)
    }
  })
  socket.on("appendDataStore", ([write, token]) => {
    try {
      if (typeof write !== "object") {
        return
      }
      if (Array.isArray(write.emailsNotify)) {
        write.emailsNotify = write.emailsNotify.filter(x => {
          if (typeof x !== "string") {
            return false
          }
          return validateEmail(x)
        })
      }
      appendDataStore(write)
      socket.emit("sendIndents", dataStore, token)
      notifyI(socket)
    }
    catch (e) {
      console.log(e)
    }
  })
});

const notifyI = (except) => {
  for (socket of sockets) {
    if (socket !== except) {
      socket.emit("sendIndents", dataStore)
    }
  }
}

const getApiAndEmit = socket => {
  const response = new Date();
  // Emitting a new message. Will be consumed by the client
  socket.emit("FromAPI", response);
};

server.listen(port, () => console.log(`Listening on port ${port}`));