const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api/v1" : "http://localhost:5000/api/v1")).replace(/\/$/, "");
const API_TIMEOUT_MS = 30_000;

const withTimeout = async (operation, timeoutMs = API_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The request timed out. Check whether a change completed before trying again.", { cause: error });
    }
    if (error instanceof TypeError) {
      throw new Error("Cannot reach the StudentHub server. Check the connection and try again.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const notifySessionExpired = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("studenthub:session-expired"));
};

const request = async (path, options = {}, { notifyOn401 = true } = {}) => {
  const { response, data } = await withTimeout(async (signal) => {
    const result = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const responseData = await result.json().catch((error) => {
      if (signal.aborted) throw error;
      return {};
    });
    return { response: result, data: responseData };
  });
  if (!response.ok) {
    if (response.status === 401 && notifyOn401) notifySessionExpired();
    const error = new Error(data.message || "The request could not be completed.");
    error.status = response.status;
    error.details = data.errors;
    throw error;
  }
  return data;
};

const academicRequest = (path, _sessionMarker, options = {}) => request(`/academics${path}`, options);

export const getCurrentUser = async () => (await request("/auth/me", {}, { notifyOn401: false })).user;
export const getStudentInvitation = (token) => request("/auth/invitations/inspect", {
  method: "POST",
  body: JSON.stringify({ token }),
}, { notifyOn401: false });
export const acceptStudentInvitation = (token, password) => request("/auth/invitations/accept", {
  method: "POST",
  body: JSON.stringify({ token, password }),
}, { notifyOn401: false });
export const inspectPasswordReset = (token) => request("/auth/password-resets/inspect", {
  method: "POST",
  body: JSON.stringify({ token }),
}, { notifyOn401: false });
export const completePasswordReset = (token, password) => request("/auth/password-resets/complete", {
  method: "POST",
  body: JSON.stringify({ token, password }),
}, { notifyOn401: false });
export const loginUser = (userData) => request("/auth/login", { method: "POST", body: JSON.stringify(userData) }, { notifyOn401: false });
export const updateMyProfile = (displayName) => request("/auth/me", {
  method: "PATCH",
  body: JSON.stringify({ displayName }),
});
export const getMyProfilePhoto = async () => {
  return withTimeout(async (signal) => {
    const response = await fetch(`${API_URL}/auth/me/photo`, { credentials: "include", signal });
    if (response.status === 401) notifySessionExpired();
    if (response.status === 404) return null;
    if (!response.ok) {
      const data = await response.json().catch((error) => {
        if (signal.aborted) throw error;
        return {};
      });
      throw new Error(data.message || "Unable to load your profile photo.");
    }
    return response.blob();
  });
};
export const updateMyProfilePhoto = (photo) => request("/auth/me/photo", {
  method: "PUT",
  headers: { "Content-Type": "image/jpeg" },
  body: photo,
});
export const deleteMyProfilePhoto = () => request("/auth/me/photo", { method: "DELETE" });
export const changePassword = (currentPassword, newPassword) => request("/auth/password", {
  method: "POST",
  body: JSON.stringify({ currentPassword, newPassword }),
});
export const logoutUser = () => request("/auth/logout", { method: "POST" }, { notifyOn401: false });

export const getStudents = (_sessionMarker, page = 1, limit = 5, filters = {}) => {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) query.set("search", filters.search);
  if (filters.course && filters.course !== "All") query.set("course", filters.course);
  if (filters.sort) query.set("sort", filters.sort);
  if (filters.status) query.set("status", filters.status);
  return request(`/students?${query.toString()}`);
};
export const getMyStudentProfile = (_sessionMarker) => request("/students/me");
export const getStudent = (id, _sessionMarker) => request(`/students/${id}`);
export const addStudent = (studentData, _sessionMarker) =>
  request("/students", { method: "POST", body: JSON.stringify(studentData) });
export const importStudents = (students, _sessionMarker) =>
  request("/students/import", { method: "POST", body: JSON.stringify({ students }) });
export const updateStudent = (id, studentData, _sessionMarker) =>
  request(`/students/${id}`, { method: "PUT", body: JSON.stringify(studentData) });
export const deleteStudent = (id, _sessionMarker) => request(`/students/${id}`, { method: "DELETE" });
export const restoreStudent = (id, _sessionMarker) => request(`/students/${id}/restore`, { method: "PATCH" });
export const createStudentInvitation = (id, _sessionMarker) =>
  request(`/students/${encodeURIComponent(id)}/invitation`, { method: "POST" });
export const createStudentPasswordReset = (id, _sessionMarker) =>
  request(`/students/${encodeURIComponent(id)}/password-reset`, { method: "POST", body: JSON.stringify({}) });
export const setStudentAccountStatus = (id, active, _sessionMarker) =>
  request(`/students/${encodeURIComponent(id)}/account-status`, { method: "PATCH", body: JSON.stringify({ active }) });

export const getAcademicSetup = (_sessionMarker, status = "active") => academicRequest(`/offerings?status=${encodeURIComponent(status)}`);
export const getEnrollmentPage = (_sessionMarker, status = "active", page = 1) =>
  academicRequest(`/enrollments?status=${encodeURIComponent(status)}&page=${page}&limit=20`);
export const getDashboardSummary = (_sessionMarker) => academicRequest("/dashboard/summary");
export const getAuditEvents = (_sessionMarker, page = 1, limit = 20) =>
  academicRequest(`/audit-events?page=${page}&limit=${limit}`);
export const downloadAcademicReport = async (filters = {}) => {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  return withTimeout(async (signal) => {
    const response = await fetch(`${API_URL}/academics/reports/export.csv?${query}`, { credentials: "include", signal });
    if (response.status === 401) notifySessionExpired();
    if (!response.ok) {
      const data = await response.json().catch((error) => {
        if (signal.aborted) throw error;
        return {};
      });
      throw new Error(data.message || "Unable to download the report.");
    }
    return response.blob();
  }, 60_000);
};
export const createCourseOffering = (payload, _sessionMarker) =>
  academicRequest("/offerings", null, { method: "POST", body: JSON.stringify(payload) });
export const archiveCourseOffering = (id, _sessionMarker) =>
  academicRequest(`/offerings/${id}/archive`, null, { method: "POST" });
export const restoreCourseOffering = (id, _sessionMarker) =>
  academicRequest(`/offerings/${id}/restore`, null, { method: "POST" });
export const enrollStudent = (payload, _sessionMarker) =>
  academicRequest("/enrollments", null, { method: "POST", body: JSON.stringify(payload) });
export const withdrawStudentEnrollment = (id, _sessionMarker) =>
  academicRequest(`/enrollments/${id}`, null, { method: "DELETE" });
export const openAttendanceSession = (payload, _sessionMarker) =>
  academicRequest("/attendance/sessions", null, { method: "POST", body: JSON.stringify(payload) });
export const saveAttendanceMarks = (id, marks, _sessionMarker) =>
  academicRequest(`/attendance/sessions/${id}/marks`, null, { method: "PUT", body: JSON.stringify({ marks }) });
export const finalizeAttendanceSession = (id, _sessionMarker) =>
  academicRequest(`/attendance/sessions/${id}/finalize`, null, { method: "POST" });
export const correctAttendanceMarks = (id, reason, marks, _sessionMarker) =>
  academicRequest(`/attendance/sessions/${id}/corrections`, null, { method: "POST", body: JSON.stringify({ reason, marks }) });
export const getMyAttendance = (_sessionMarker, page = 1, limit = 20) =>
  request(`/students/me/attendance?page=${page}&limit=${limit}`);
export const getAssessments = (offeringId, _sessionMarker) =>
  academicRequest(`/assessments?offeringId=${encodeURIComponent(offeringId)}`);
export const createAssessment = (payload, _sessionMarker) =>
  academicRequest("/assessments", null, { method: "POST", body: JSON.stringify(payload) });
export const getAssessment = (id, _sessionMarker) => academicRequest(`/assessments/${id}`);
export const getAssessmentHistory = (id, page = 1, _sessionMarker) =>
  academicRequest(`/assessments/${id}/history?page=${page}&limit=20`);
export const saveDraftGrades = (id, grades, expectedRevision, _sessionMarker) =>
  academicRequest(`/assessments/${id}/grades`, null, { method: "PUT", body: JSON.stringify({ grades, expectedRevision }) });
export const publishAssessment = (id, expectedRevision, _sessionMarker) =>
  academicRequest(`/assessments/${id}/publish`, null, { method: "POST", body: JSON.stringify({ expectedRevision }) });
export const correctPublishedGrades = (id, reason, grades, expectedRevision, _sessionMarker) =>
  academicRequest(`/assessments/${id}/corrections`, null, { method: "POST", body: JSON.stringify({ reason, grades, expectedRevision }) });
export const getMyResults = (_sessionMarker, page = 1, limit = 20) =>
  request(`/students/me/results?page=${page}&limit=${limit}`);
