function StudentTable({
  students,
  onEdit,
  onDelete,
  onInvite,
  onRestore,
  onAccountStatusChange,
  onPasswordReset,
  passwordResetDisabled = false,
  accountStatusBusy = false,
  status = "active",
  inviteDisabled = false,
  archiveDisabled = false,
}) {

  return (
    <div className="table-wrapper">

      <table>

        <thead>

          <tr>
            <th>Student</th>
            <th>Course</th>
            <th>Batch</th>
            <th>Legacy Attendance</th>
            <th>Legacy Assignment</th>
            <th>Legacy Final Score</th>
            <th>Record</th>
            <th>Account</th>
            <th>Actions</th>
          </tr>

        </thead>


        <tbody>

          {students.map((student) => (

            <tr
              key={
                student._id ||
                student.id
              }
            >


              {/* STUDENT */}

              <td>

                <div className="student-name">

                  <div className="student-avatar">

                    {student.name
                      ? student.name
                          .charAt(0)
                          .toUpperCase()
                      : "S"}

                  </div>


                  <div>

                    <strong>
                      {student.name}
                    </strong>

                    <small>
                      {student.email}
                    </small>
                    {student.studentNumber && <small>Student no. {student.studentNumber}</small>}

                  </div>

                </div>

              </td>

              {/* COURSE */}

              <td>
                {student.course || "—"}
              </td>


              {/* BATCH */}

              <td>

                <span className="batch">
                  {student.batch || "—"}
                </span>

              </td>


              {/* ATTENDANCE */}

              <td>
                {student.attendance == null ? "—" : `${student.attendance}%`}
              </td>


              {/* ASSIGNMENT */}

              <td>
                {student.assignmentScore == null ? "—" : `${student.assignmentScore}%`}
              </td>


              {/* FINAL SCORE */}

              <td>
                {student.finalScore == null ? "—" : `${student.finalScore}%`}
              </td>

              <td>{student.status === "archived" ? "Archived" : "Active"}</td>
              <td><span className={`student-account-status ${student.accountStatus || "not_invited"}`}>
                {{
                  account_linked: "Account linked",
                  account_disabled: "Account disabled",
                  account_link_broken: "Account link needs repair",
                  account_conflict: "Email account conflict",
                  invitation_pending: student.invitationEmailStatus === "sent" ? "Invite email sent" : student.invitationEmailStatus === "failed" ? "Invite email failed" : student.invitationEmailStatus === "not_configured" ? "Invite link ready" : student.invitationEmailStatus === "pending" ? "Invite email queued" : "Invite pending",
                  invitation_expired: "Invite expired",
                  link_replaced: "Invite replaced",
                  not_invited: "Not invited",
                }[student.accountStatus || "not_invited"]}
              </span></td>


              {/* ACTIONS */}

              <td>

                <div className="actions">

                  {status === "active" && ["account_linked", "account_disabled"].includes(student.accountStatus) && <button
                    type="button"
                    className={student.accountStatus === "account_linked" ? "student-access-disable" : "student-access-enable"}
                    title={student.accountStatus === "account_linked" ? "Disable account access" : "Reactivate account access"}
                    aria-label={`${student.accountStatus === "account_linked" ? "Disable" : "Reactivate"} account access for ${student.name}`}
                    disabled={accountStatusBusy}
                    onClick={() => onAccountStatusChange(student, student.accountStatus !== "account_linked")}
                  >
                    {student.accountStatus === "account_linked" ? "🔒" : "🔓"}
                  </button>}

                  {status === "active" && student.accountStatus === "account_linked" && <button
                    type="button"
                    title="Issue a one-time password reset link"
                    aria-label={`Issue a password reset link for ${student.name}`}
                    disabled={passwordResetDisabled}
                    onClick={() => onPasswordReset(student)}
                  >
                    🔑
                  </button>}

                  {status === "active" && !["account_linked", "account_disabled", "account_conflict"].includes(student.accountStatus) && !student.userId && <button
                    type="button"
                    title={student.accountStatus === "invitation_pending" ? "Replace the active invitation" : "Create or reissue student account invitation"}
                    aria-label={`Invite ${student.name} to activate an account`}
                    disabled={inviteDisabled}
                    onClick={() => onInvite(student)}
                  >
                    ✉️
                  </button>}

                  {status === "active" && <button
                    type="button"
                    title="Edit"
                    onClick={() =>
                      onEdit(student)
                    }
                  >
                    ✏️
                  </button>}


                  {status === "active" ? <button
                    type="button"
                    title="Archive student"
                    aria-label={`Archive ${student.name}`}
                    disabled={archiveDisabled}
                    onClick={() =>
                      onDelete(
                        student._id ||
                          student.id
                      )
                    }
                  >
                    🗑️
                  </button> : <button
                    type="button"
                    title="Restore student"
                    aria-label={`Restore ${student.name}`}
                    onClick={() => onRestore(student)}
                  >
                    ↩️
                  </button>}

                </div>

              </td>

            </tr>

          ))}

        </tbody>

      </table>


      {/* EMPTY */}

      {students.length === 0 && (

        <div className="empty-state">

          <h3>
            No students found
          </h3>

          <p>
            Try changing your search
            or filter.
          </p>

        </div>

      )}

    </div>
  );
}


export default StudentTable;
