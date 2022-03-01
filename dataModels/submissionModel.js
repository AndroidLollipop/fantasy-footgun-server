const rawSubmissionModel = {fields: [{name: "nickname", initialData: "", columnName: "Name", friendlyName: "Name", fieldType: "single"}, {name: "sar21", initialData: null, columnName: "SAR21", friendlyName: "Best SAR21" ,fieldType: "selectBlob", blobName: "Soldiers", display: "textPhoto"}, {name: "saw", initialData: null, columnName: "SAW", friendlyName: "Best SAW" ,fieldType: "selectBlob", blobName: "Soldiers", display: "textPhoto"}, {name: "gpmg", initialData: null, columnName: "GPMG", friendlyName: "Best GPMG" ,fieldType: "selectBlob", blobName: "Soldiers", display: "textPhoto"}], data: {}, blobs: {"Soldiers": [
  {name: "Alpha", fullName: "PTE 1", friendlyName: "Alpha - PTE 1", photo: "https://i.pinimg.com/originals/3e/37/24/3e3724692c15d28f12a4c7bc6fe0b945.jpg"},
  {name: "Bravo", fullName: "PTE 2", friendlyName: "Bravo - PTE 2", photo: "https://scontent.fsin13-1.fna.fbcdn.net/v/t1.6435-9/64861023_2345584528868126_2696896092137586688_n.jpg?_nc_cat=107&ccb=1-5&_nc_sid=174925&_nc_ohc=kUjXJTOpnBwAX-aymIb&_nc_ht=scontent.fsin13-1.fna&oh=00_AT80RHyc6Z9aJrAh8nXipP93by8NOtWDXFiVM6iktKjBfg&oe=62306048"},
  {name: "Charlie", fullName: "PTE 3", friendlyName: "Charlie - PTE 3", photo: "https://i.pinimg.com/280x280_RS/d2/ab/39/d2ab39788ec4254ab7761317448f5da3.jpg"},
  {name: "Support", fullName: "PTE 4", friendlyName: "Support - PTE 4", photo: "https://c8.alamy.com/comp/D198EY/a-balinese-man-in-a-singapore-army-camo-shirt-D198EY.jpg"},
  {name: "MSC", fullName: "PTE 5", friendlyName: "MSC - PTE 5", photo: "https://www.janes.com/images/default-source/news-images/fg_3808936-idr-9354.jpg?sfvrsn=b60dfede_2"}
]}}
const rawOptionalFields = []

var columns = []
var fields = []
var optionalFields = []

for (const submission of rawSubmissionModel.fields) {
  columns.push(submission.columnName)
  fields.push(submission.name)
}

columns = [...columns.slice(0, 1), "Total Score", ...columns.slice(1)]

for (const optionalField of rawOptionalFields) {
  optionalFields.push(optionalField)
}

module.exports = {
  columns,
  fields,
  optionalFields
}