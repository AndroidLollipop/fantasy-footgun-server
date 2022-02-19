const validateType = (type) => (object) => {
  if (typeof type === "string") {
    if (type === "null") {
      return object === null
    }
    return typeof object === type
  }
  if (Array.isArray(type)) {
    for (const option of type) {
      if (validateType(option)(object)) {
        return true
      }
    }
    return false
  }
  if (type.type === "object") {
    var matches = 0
    var keys = Object.keys(type.object)
    if (!(typeof object === "object")) {
      return false
    }
    for (const key of keys) {
      if (validateType(type.object[key])(object[key])) {
        if (object[key] !== undefined) {
          matches++
        }
      }
      else {
        return false
      }
    }
    if (matches !== Object.keys(object).length) {
      return false
    }
    return true
  }
  if (type.type === "array") {
    if (!Array.isArray(object)) {
      return false
    }
    for (const element of object) {
      if (!validateType(type.specimen)(element)) {
        return false
      }
    }
    return true
  }
  return false
}

module.exports = validateType