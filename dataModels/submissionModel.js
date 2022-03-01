const rawSubmissionModel = require("./formModel.js")
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