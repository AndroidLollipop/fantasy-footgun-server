const fs = require('fs')
var dataStore = [
  {name: "Driving course", internalUID: 0, startDateTime: "01/04/2020 12:34", endDateTime: "01/04/2020 23:45", POC: "John Doe", POCPhone: "999", origin: "KC3", destination: "SAF Driving Circuit", status: "Pending"}, 
  {name: "Diving course", internalUID: 1, startDateTime: "01/04/2020 12:34", endDateTime: "01/04/2020 23:45", POC: "Jane Doe", POCPhone: "999", origin: "KC3", destination: "Changi Naval Base", status: "Pending"}, 
  {name: "Paratrooper course", internalUID: 2, startDateTime: "01/04/2020 12:34", endDateTime: "01/04/2020 23:45", POC: "Alice", POCPhone: "999", origin: "KC3", destination: "QPG", status: "Pending"}
]
var notificationsStore = [{title: "Indent \"Driving course\" is now Pending", internalUID: 0}]
const dataJSON = JSON.stringify(dataStore)
const notificationsJSON = JSON.stringify(notificationsStore)
fs.writeFile('./defaultData/dataStore.json', dataJSON, ()=>{})
fs.writeFile('./defaultData/notificationsStore.json', notificationsJSON, ()=>{})
fs.writeFile('./defaultData/uid.json', JSON.stringify(dataStore.length), ()=>{})