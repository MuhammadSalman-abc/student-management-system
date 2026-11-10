const Student = require("../models/Student");

// An explicit userId relationship is authoritative. Email lookup is only a
// compatibility path for older records that have not yet been linked.
const findStudentForUser = async (userId, email, projection) => {
  let linkedQuery = Student.findOne({ userId });
  if (projection) linkedQuery = linkedQuery.select(`${projection} status`);
  const linkedStudent = await linkedQuery.lean();
  if (linkedStudent) return linkedStudent.status === "archived" ? null : linkedStudent;

  let legacyQuery = Student.findOne({
    userId: null,
    email,
    status: { $ne: "archived" },
  });
  if (projection) legacyQuery = legacyQuery.select(projection);
  return legacyQuery.lean();
};

module.exports = findStudentForUser;
