export type Role = 'administrator' | 'staff' | 'client';

export interface User {
  id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  must_change_password: boolean;
  role: Role;
  username: string;
}

export interface Note {
  id: number;
  note_type: string;
  body: string;
  author_name?: string | null;
  created_at: string;
}

export interface Photo {
  id: number;
  filename: string;
  original_name?: string | null;
  category: string;
  caption?: string | null;
  created_at: string;
}

export interface DocumentFile {
  id: number;
  filename: string;
  original_name?: string | null;
  content_type?: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  event_type: string;
  description: string;
  actor_name?: string | null;
  created_at: string;
}

export interface InspectionItem {
  id: number;
  label: string;
  result?: string | null;
  notes?: string | null;
  order_index: number;
}

export interface Inspection {
  id: number;
  component_type: string;
  title?: string | null;
  inspector_name?: string | null;
  completed: boolean;
  created_at: string;
  items: InspectionItem[];
}

export interface JobListItem {
  id: number;
  job_number: string;
  customer_name: string;
  component_type?: string | null;
  status: string;
  date_received: string;
  created_at: string;
}

export interface JobDetail extends JobListItem {
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  po_number?: string | null;
  description?: string | null;
  photos: Photo[];
  documents: DocumentFile[];
  notes: Note[];
  timeline: TimelineEvent[];
  inspections: Inspection[];
  client_user_ids: number[];
  final_inspection?: FinalInspection | null;
  checked_in: boolean;
}

export interface CheckinStatus {
  token: string;
  url: string;
  qr_png: string;
  checked_in: boolean;
  inspection_complete: boolean;
  operator_name?: string | null;
  machine?: string | null;
  checked_in_at?: string | null;
}

export interface TemplateItem {
  id: number;
  label: string;
  order_index: number;
}

export interface Template {
  id: number;
  component_type: string;
  name: string;
  items: TemplateItem[];
}

export interface AppSettings {
  company_name: string;
  company_logo?: string | null;
  dashboard_branding?: string | null;
  job_number_prefix: string;
  email_host?: string | null;
  email_port?: string | null;
  email_user?: string | null;
  email_from?: string | null;
  github_repo_url?: string | null;
  current_version: string;
  available_version?: string | null;
}

export interface DashboardStats {
  received: number;
  machining: number;
  completed: number;
  closed: number;
  total: number;
  status_breakdown: Record<string, number>;
  recent_activity: TimelineEvent[];
}

export interface JobReportItem {
  id: number;
  job_number: string;
  customer_name: string;
  po_number?: string | null;
  component_type?: string | null;
  status: string;
  date_received: string;
}

export interface JobReportResponse {
  period: 'month' | 'year';
  year: number;
  month?: number | null;
  period_label: string;
  generated_at: string;
  company_name: string;
  total: number;
  status_breakdown: Record<string, number>;
  status_filter?: string | null;
  jobs: JobReportItem[];
}

export interface Review {
  id: number;
  job_id: number;
  requested_at: string;
  completed: boolean;
  rating?: number | null;
  feedback?: string | null;
  improvement?: string | null;
  reviewer_name?: string | null;
  completed_at?: string | null;
}

export interface FinalInspectionAttempt {
  id: number;
  attempt_number: number;
  result: 'passed' | 'failed';
  inspector_name?: string | null;
  reason?: string | null;
  internal_reference?: string | null;
  created_at: string;
}

export interface FinalInspection {
  id: number;
  job_id: number;
  requested_at: string;
  completed: boolean;
  inspector_name?: string | null;
  internal_reference?: string | null;
  result?: 'passed' | 'failed' | null;
  failure_reason?: string | null;
  attempts: number;
  failed_at?: string | null;
  completed_at?: string | null;
  attempts_log: FinalInspectionAttempt[];
}

export interface PendingReview {
  job_id: number;
  job_number: string;
  customer_name: string;
}

export interface PendingInspection {
  job_id: number;
  job_number: string;
  customer_name: string;
  attempts: number;
  is_reinspection: boolean;
}

export interface NCRListItem {
  id: number;
  ncr_number: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  job_id?: number | null;
  job_number?: string | null;
  created_at: string;
}

export interface NCR extends NCRListItem {
  description: string;
  source: string;
  disposition: string;
  root_cause?: string | null;
  corrective_action?: string | null;
  assigned_to?: string | null;
  raised_by_name?: string | null;
  closed_by_name?: string | null;
  updated_at: string;
  closed_at?: string | null;
}

export interface NCRMeta {
  categories: string[];
  severities: string[];
  sources: string[];
  dispositions: string[];
  statuses: string[];
}

export interface ReviewNotification {
  review_id: number;
  job_id: number;
  job_number: string;
  customer_name: string;
  rating?: number | null;
  reviewer_name?: string | null;
  completed_at?: string | null;
}
