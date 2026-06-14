import axios from 'axios';
import type {
  AppSettings,
  CheckinStatus,
  DashboardStats,
  FinalInspection,
  Inspection,
  JobDetail,
  JobListItem,
  JobReportResponse,
  LoginResponse,
  Note,
  Photo,
  PendingReview,
  PendingInspection,
  NCR,
  NCRListItem,
  NCRMeta,
  Review,
  ReviewNotification,
  Template,
  User,
} from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wiq_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('wiq_token');
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const apiError = (e: unknown, fallback = 'Something went wrong'): string => {
  if (axios.isAxiosError(e)) {
    if (e.code === 'ECONNABORTED') return 'The server took too long to respond. Please try again.';
    if (e.code === 'ERR_NETWORK') return 'Network error — could not reach the server.';
    const d = e.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  }
  return fallback;
};

// Auth
export const login = async (username: string, password: string) => {
  const form = new URLSearchParams({ username, password });
  const { data } = await api.post<LoginResponse>('/auth/login', form);
  return data;
};
export const fetchMe = async () => (await api.get<User>('/auth/me')).data;
export const changePassword = (current_password: string, new_password: string) =>
  api.post('/auth/change-password', { current_password, new_password });

// Users
export const listUsers = async () => (await api.get<User[]>('/users')).data;
export const listClients = async () => (await api.get<User[]>('/users/clients')).data;
export const createUser = (body: Partial<User> & { password: string }) =>
  api.post<User>('/users', body);
export const updateUser = (id: number, body: Record<string, unknown>) =>
  api.put<User>(`/users/${id}`, body);
export const deleteUser = (id: number) => api.delete(`/users/${id}`);

// Meta
export const fetchMeta = async () =>
  (await api.get<{ component_types: string[]; statuses: string[] }>('/templates/meta')).data;

// Jobs
export const listJobs = async (status?: string) =>
  (await api.get<JobListItem[]>('/jobs', { params: status ? { status } : {} })).data;
export const getJob = async (id: number) => (await api.get<JobDetail>(`/jobs/${id}`)).data;
export const createJob = async (body: Record<string, unknown>) =>
  (await api.post<JobDetail>('/jobs', body)).data;
export const updateJob = async (id: number, body: Record<string, unknown>) =>
  (await api.put<JobDetail>(`/jobs/${id}`, body)).data;
export const deleteJob = (id: number) => api.delete(`/jobs/${id}`);
export const assignClients = async (id: number, user_ids: number[]) =>
  (await api.put<JobDetail>(`/jobs/${id}/clients`, { user_ids })).data;

// Check-in QR
export const getCheckin = async (jobId: number) =>
  (await api.get<CheckinStatus>(`/jobs/${jobId}/checkin`)).data;

// Notes
export const addNote = async (jobId: number, note_type: string, body: string) =>
  (await api.post<Note>(`/jobs/${jobId}/notes`, { note_type, body })).data;

// Photos & documents
export const uploadPhotos = async (
  jobId: number,
  files: File[],
  category: string,
  caption?: string,
) => {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('category', category);
  if (caption) fd.append('caption', caption);
  return (await api.post<Photo[]>(`/jobs/${jobId}/photos`, fd)).data;
};
export const deletePhoto = (jobId: number, photoId: number) =>
  api.delete(`/jobs/${jobId}/photos/${photoId}`);
export const uploadDocuments = async (jobId: number, files: File[]) => {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  return api.post(`/jobs/${jobId}/documents`, fd);
};
export const deleteDocument = (jobId: number, docId: number) =>
  api.delete(`/jobs/${jobId}/documents/${docId}`);
export const fileUrl = (jobId: number, filename: string) => {
  const token = localStorage.getItem('wiq_token');
  return `/api/jobs/${jobId}/files/${filename}?_t=${token}`;
};
export const fetchFileBlob = async (jobId: number, filename: string) => {
  const { data } = await api.get(`/jobs/${jobId}/files/${filename}`, { responseType: 'blob' });
  return URL.createObjectURL(data);
};

// Inspections
export const createInspection = async (jobId: number, component_type: string, title?: string) =>
  (await api.post<Inspection>(`/jobs/${jobId}/inspections`, { component_type, title })).data;
export const updateInspection = async (
  jobId: number,
  inspectionId: number,
  body: Record<string, unknown>,
) => (await api.put<Inspection>(`/jobs/${jobId}/inspections/${inspectionId}`, body)).data;
export const deleteInspection = (jobId: number, inspectionId: number) =>
  api.delete(`/jobs/${jobId}/inspections/${inspectionId}`);

// Templates
export const listTemplates = async () => (await api.get<Template[]>('/templates')).data;
export const createTemplate = (component_type: string, name: string, items: string[]) =>
  api.post<Template>('/templates', { component_type, name, items });
export const updateTemplate = (id: number, body: { name?: string; items?: string[] }) =>
  api.put<Template>(`/templates/${id}`, body);
export const deleteTemplate = (id: number) => api.delete(`/templates/${id}`);

// Settings
export const getSettings = async () => (await api.get<AppSettings>('/settings')).data;
export const updateSettings = async (body: Record<string, unknown>) =>
  (await api.put<AppSettings>('/settings', body)).data;
export const checkUpdates = async () => (await api.post<AppSettings>('/settings/check-updates')).data;
export const applyUpdate = async () => (await api.post('/settings/apply-update')).data;
export const getUpdateStatus = async () =>
  (await api.get<{ status: string; log: string }>('/settings/update-status')).data;
export const uploadLogo = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return (await api.post<AppSettings>('/settings/logo', fd)).data;
};

// Backup & restore (admin)
export const downloadBackup = async () => {
  const res = await api.get('/settings/backup', { responseType: 'blob', timeout: 600000 });
  const cd = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] || `workshopiq-backup-${Date.now()}.zip`;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Android app (.apk) download (admin)
export const downloadAndroidApp = async () => {
  const res = await api.get('/settings/app/android', { responseType: 'blob', timeout: 120000 });
  const cd = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] || 'WorkshopIQ.apk';
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const restoreBackup = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return (
    await api.post('/settings/restore', fd, { timeout: 600000 })
  ).data as {
    status: string;
    restored_from_version?: string;
    created_at?: string;
    counts: Record<string, number>;
  };
};

// Dashboard
export const getDashboard = async () => (await api.get<DashboardStats>('/dashboard')).data;

// Reports
export const getJobReport = async (params: {
  period: 'month' | 'year';
  year: number;
  month?: number;
  status?: string;
}) => (await api.get<JobReportResponse>('/reports/jobs', { params })).data;

// Customer reviews
export const requestReview = async (jobId: number) =>
  (await api.post<Review>(`/jobs/${jobId}/review`)).data;
export const getReview = async (jobId: number) =>
  (await api.get<Review | null>(`/jobs/${jobId}/review`)).data;
export const submitReview = async (
  jobId: number,
  body: { rating: number; feedback?: string; improvement?: string },
) => (await api.put<Review>(`/jobs/${jobId}/review`, body)).data;
export const getPendingReviews = async () =>
  (await api.get<PendingReview[]>('/reviews/pending')).data;

// Final inspection
export const getFinalInspection = async (jobId: number) =>
  (await api.get<FinalInspection | null>(`/jobs/${jobId}/final-inspection`)).data;
export const releaseFinalInspection = async (jobId: number) =>
  (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection`)).data;
export const submitFinalInspection = async (
  jobId: number,
  body: { inspector_name: string; internal_reference?: string },
) => (await api.put<FinalInspection>(`/jobs/${jobId}/final-inspection`, body)).data;
export const failFinalInspection = async (
  jobId: number,
  body: { inspector_name: string; reason: string },
) => (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection/fail`, body)).data;
export const getPendingInspections = async () =>
  (await api.get<PendingInspection[]>('/final-inspection/pending')).data;
export const getReviewNotifications = async () =>
  (await api.get<ReviewNotification[]>('/reviews/notifications')).data;
export const markReviewNotificationsSeen = async (review_ids: number[]) =>
  api.post('/reviews/notifications/seen', { review_ids });

// NCRs (Non-Conformance Reports)
export const fetchNCRMeta = async () => (await api.get<NCRMeta>('/ncrs/meta')).data;
export const listNCRs = async (params?: { status?: string; job_id?: number }) =>
  (await api.get<NCRListItem[]>('/ncrs', { params: params || {} })).data;
export const getNCR = async (id: number) => (await api.get<NCR>(`/ncrs/${id}`)).data;
export const createNCR = async (body: Record<string, unknown>) =>
  (await api.post<NCR>('/ncrs', body)).data;
export const updateNCR = async (id: number, body: Record<string, unknown>) =>
  (await api.put<NCR>(`/ncrs/${id}`, body)).data;
export const deleteNCR = (id: number) => api.delete(`/ncrs/${id}`);

export default api;
