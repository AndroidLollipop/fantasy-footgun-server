const shapes = {
  stateSubmission: {
    type: "object",
    object: {
      scoreRows: ["boolean", "undefined"],
      allowSubmissions: ["boolean", "undefined"],
    }
  },
  notificationsSubmission: {
    type: "array",
    specimen: {
      type: "object",
      object: {
        name: "string",
        category: "string",
        winner: "string"
      }
    }
  }
}

module.exports = shapes