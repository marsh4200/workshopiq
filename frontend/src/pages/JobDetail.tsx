import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Rating,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DescriptionIcon from '@mui/icons-material/Description';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  getJob,
  updateJob,
  deleteJob,
  addNote,
  uploadPhotos,
  deletePhoto,
  uploadDocuments,
  deleteDocument,
  fetchFileBlob,
  createInspection,
  updateInspection,
  deleteInspection,
  fetchMeta,
  listClients,
  assignClients,
  listCostItems,
  addCostItem,
  deleteCostItem,
  getCheckin,
  getReview,
  requestReview,
  getFinalInspection,
  releaseFinalInspection,
  submitFinalInspection,
  failFinalInspection,
  apiError,
} from '../api/client';
import { StatusBadge, StatusBanner, ClosedBanner, ResultBadge, fmtDate, fmtDay, EmptyState } from '../components/common';
import PhotoGallery from '../components/PhotoGallery';
import ReviewDialog from '../components/ReviewDialog';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { CheckinStatus, Inspection, JobDetail as JobDetailT, JobCostItem, Review, User } from '../types';

const zarFmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const fmtMoney = (n: number) => zarFmt.format(Number.isFinite(n) ? n : 0);

const NOTE_TYPES = [
  { value: 'internal', label: 'Internal' },
  { value: 'customer', label: 'Customer' },
  { value: 'query', label: 'Query' },
  { value: 'progress', label: 'Progress' },
  { value: 'action', label: 'Action' },
];

const NOTE_COLORS: Record<string, string> = {
  internal: '#64748b',
  customer: '#14b8a6',
  query: '#f59e0b',
  progress: '#3b82f6',
  action: '#a855f7',
};

/**
 * The tab labels shown for a job, in order. Kept as a pure helper so the
 * `?tab=<label>` deep link (used by the client inspection/review banners) and
 * the rendered tab bar always agree on the index for a given label.
 */
function buildTabs(readOnly: boolean, isAdmin: boolean): string[] {
  const tabs = ['Overview', 'Inspections'];
  if (!readOnly) tabs.push('Machine Check-In');
  tabs.push('Photos', 'Documents', 'Notes', 'Timeline', 'Final Inspection', 'Review');
  if (!readOnly) tabs.push('Costing', 'Client Access');
  return tabs;
}

export default function JobDetail() {
  const { id } = useParams();
  const jobId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isClient, isAdmin } = useAuth();
  const { isMobile } = useDeviceType();
  const readOnly = isClient;

  const [job, setJob] = useState<JobDetailT | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteJob(jobId);
      navigate('/jobs', { replace: true });
    } catch (e) {
      setError(apiError(e, 'Failed to delete job'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const reload = useCallback(() => {
    return getJob(jobId)
      .then(setJob)
      .catch((e) => setError(apiError(e, 'Failed to load job')));
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    // Paint the job as soon as it loads. The status/component dropdown data
    // (fetchMeta) can arrive a beat later without holding up the whole page.
    reload().finally(() => setLoading(false));
    fetchMeta()
      .then((m) => {
        setStatuses(m.statuses);
        setComponentTypes(m.component_types);
      })
      .catch(() => undefined);
  }, [reload]);

  // Honour a ?tab=<label> deep link (e.g. the client banners link straight to
  // "Final Inspection"). Runs once the job is loaded so the tab list is final.
  useEffect(() => {
    const want = searchParams.get('tab');
    if (!want || !job) return;
    const idx = buildTabs(readOnly, isAdmin).indexOf(want);
    if (idx >= 0) setTab(idx);
  }, [searchParams, job, readOnly, isAdmin]);

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  if (!job)
    return <Typography color="error">{error || 'Job not found.'}</Typography>;

  const tabs = buildTabs(readOnly, isAdmin);

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/jobs')}>
          Back to Jobs
        </Button>
        {isAdmin && (
          <Button
            color="error"
            variant="outlined"
            startIcon={<DeleteIcon />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete Job
          </Button>
        )}
      </Stack>

      <Box sx={{ mb: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{ flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography variant="h4" fontWeight={800}>
            {job.job_number}
          </Typography>
          <StatusBanner status={job.status} />
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          {job.customer_name}
          {job.component_type ? ` · ${job.component_type}` : ''}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {isMobile ? (
        <TextField
          select
          fullWidth
          size="small"
          label="Section"
          value={tab}
          onChange={(e) => setTab(Number(e.target.value))}
          sx={{ mb: 3 }}
        >
          {tabs.map((t, i) => (
            <MenuItem key={t} value={i}>
              {t}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t} label={t} />
          ))}
        </Tabs>
      )}

      {tabs[tab] === 'Overview' && (
        <OverviewTab
          job={job}
          statuses={statuses}
          componentTypes={componentTypes}
          readOnly={readOnly}
          onUpdate={reload}
          setError={setError}
        />
      )}
      {tabs[tab] === 'Machine Check-In' && <CheckInTab job={job} onUpdate={reload} />}
      {tabs[tab] === 'Inspections' && (
        <InspectionsTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Photos' && (
        <PhotosTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Documents' && (
        <DocumentsTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Notes' && (
        <NotesTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Timeline' && <TimelineTab job={job} />}
      {tabs[tab] === 'Final Inspection' && (
        <FinalInspectionTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Review' && (
        <ReviewTab job={job} readOnly={readOnly} setError={setError} />
      )}
      {tabs[tab] === 'Costing' && <CostingTab job={job} setError={setError} />}
      {tabs[tab] === 'Client Access' && (
        <ClientAccessTab job={job} onUpdate={reload} setError={setError} />
      )}

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} fullWidth maxWidth="xs">
        <DialogTitle>Delete {job.job_number}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This permanently removes the job and everything attached to it —
            inspections, photos, documents, notes and timeline. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete Job'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ---------------- Overview ---------------- */
function OverviewTab({
  job,
  statuses,
  componentTypes,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  statuses: string[];
  componentTypes: string[];
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    customer_name: job.customer_name,
    contact_person: job.contact_person || '',
    phone: job.phone || '',
    email: job.email || '',
    po_number: job.po_number || '',
    eq_number: job.eq_number || '',
    component_type: job.component_type || '',
    description: job.description || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  const changeStatus = async (status: string) => {
    try {
      await updateJob(job.id, { status });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to update status'));
    }
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      Object.keys(body).forEach((k) => {
        if (body[k] === '') body[k] = null;
      });
      await updateJob(job.id, body);
      setEditing(false);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Grid container spacing={3}>
        {job.status === 'Closed' && (
          <Grid item xs={12}>
            <ClosedBanner />
          </Grid>
        )}
      <Grid item xs={12} md={8}>
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                Job Details
              </Typography>
              {!readOnly &&
                (editing ? (
                  <Stack direction="row" spacing={1}>
                    <Button size="small" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="small" variant="contained" onClick={saveDetails} disabled={saving}>
                      Save
                    </Button>
                  </Stack>
                ) : (
                  <Button size="small" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ))}
            </Stack>

            {editing ? (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField label="Customer" fullWidth value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Contact" fullWidth value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Phone" fullWidth value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Email" fullWidth value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="PO Number" fullWidth value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="EQ Number" fullWidth value={form.eq_number} onChange={(e) => setForm((f) => ({ ...f, eq_number: e.target.value }))} helperText="Optional" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField select label="Component Type" fullWidth value={form.component_type} onChange={(e) => setForm((f) => ({ ...f, component_type: e.target.value }))}>
                    <MenuItem value="">— Not specified —</MenuItem>
                    {componentTypes.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12}>
                  <TextField label="Description" fullWidth multiline minRows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </Grid>
              </Grid>
            ) : (
              <Table size="small">
                <TableBody>
                  <Row label="Customer" value={job.customer_name} />
                  <Row label="Contact Person" value={job.contact_person} />
                  <Row label="Phone" value={job.phone} />
                  <Row label="Email" value={job.email} />
                  <Row label="PO Number" value={job.po_number} />
                  <Row label="EQ Number" value={job.eq_number} />
                  <Row label="Component Type" value={job.component_type} />
                  <Row label="Date Received" value={fmtDay(job.date_received)} />
                  <Row label="Created" value={fmtDate(job.created_at)} />
                  {!readOnly && job.client_names.length > 0 && (
                    <Row label="Client Access" value={job.client_names.join(', ')} />
                  )}
                  <TableCell sx={{ border: 0, pt: 2 }} colSpan={2}>
                    <Typography variant="caption" color="text.secondary">
                      Description
                    </Typography>
                    <Typography>{job.description || '—'}</Typography>
                  </TableCell>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
              Status
            </Typography>
            {readOnly ? (
              <StatusBadge status={job.status} />
            ) : isAdmin ? (
              <TextField
                select
                fullWidth
                value={job.status}
                onChange={(e) => changeStatus(e.target.value)}
              >
                {(statuses.includes(job.status) ? statuses : [job.status, ...statuses]).map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Stack spacing={1.25} alignItems="flex-start">
                <StatusBadge status={job.status} />
                <Typography variant="caption" color="text.secondary">
                  Status updates automatically as the job moves through check-in,
                  inspection and review.
                </Typography>
                {job.status !== 'Closed' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    startIcon={<LockOutlinedIcon />}
                    onClick={() => setConfirmClose(true)}
                  >
                    Close Job
                  </Button>
                )}
              </Stack>
            )}
            <Divider sx={{ my: 2 }} />
            <Stack spacing={1}>
              <Stat label="Inspections" value={job.inspections.length} />
              <Stat label="Photos" value={job.photos.length} />
              <Stat label="Documents" value={job.documents.length} />
              <Stat label="Notes" value={job.notes.length} />
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      </Grid>

      <Dialog open={confirmClose} onClose={() => !closing && setConfirmClose(false)} fullWidth maxWidth="xs">
        <DialogTitle>Close {job.job_number}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This marks the job as closed — use it when a job has been pulled or
            cancelled. Normal jobs close automatically once the workflow finishes.
            An administrator can reopen it if needed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmClose(false)} disabled={closing}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="inherit"
            startIcon={<LockOutlinedIcon />}
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              await changeStatus('Closed');
              setClosing(false);
              setConfirmClose(false);
            }}
          >
            {closing ? 'Closing…' : 'Close Job'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, color: 'text.secondary', width: 160, verticalAlign: 'top' }}>
        {label}
      </TableCell>
      <TableCell sx={{ border: 0 }}>{value || '—'}</TableCell>
    </TableRow>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography color="text.secondary">{label}</Typography>
      <Typography fontWeight={700}>{value}</Typography>
    </Stack>
  );
}

/* ---------------- Inspections ---------------- */
function InspectionsTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [newType, setNewType] = useState(job.component_type || '');

  useEffect(() => {
    fetchMeta().then((m) => setComponentTypes(m.component_types)).catch(() => undefined);
  }, []);

  const start = async () => {
    try {
      await createInspection(job.id, newType);
      setCreateOpen(false);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to create inspection'));
    }
  };

  return (
    <Box>
      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setNewType(job.component_type || componentTypes[0] || '');
              setCreateOpen(true);
            }}
          >
            New Inspection
          </Button>
        </Stack>
      )}

      {job.inspections.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No inspections yet" subtitle="Start an inspection to load its checklist." />
        </Card>
      ) : (
        <Stack spacing={3}>
          {job.inspections.map((insp) => (
            <InspectionCard
              key={insp.id}
              jobId={job.id}
              inspection={insp}
              readOnly={readOnly}
              onUpdate={onUpdate}
              setError={setError}
            />
          ))}
        </Stack>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New Inspection</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Component Type"
            fullWidth
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            sx={{ mt: 1 }}
          >
            {componentTypes.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={start} disabled={!newType}>
            Start Inspection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function InspectionCard({
  jobId,
  inspection,
  readOnly,
  onUpdate,
  setError,
}: {
  jobId: number;
  inspection: Inspection;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [items, setItems] = useState(inspection.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(inspection.items);
    setDirty(false);
  }, [inspection]);

  const setResult = (itemId: number, result: string) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, result } : i)));
    setDirty(true);
  };
  const setNotes = (itemId: number, notes: string) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, notes } : i)));
    setDirty(true);
  };

  const save = async (completed?: boolean) => {
    setSaving(true);
    try {
      await updateInspection(jobId, inspection.id, {
        completed: completed ?? inspection.completed,
        items: items.map((i) => ({ id: i.id, result: i.result ?? null, notes: i.notes ?? null })),
      });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to save inspection'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this inspection?')) return;
    try {
      await deleteInspection(jobId, inspection.id);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete inspection'));
    }
  };

  const passCount = items.filter((i) => i.result === 'pass').length;
  const failCount = items.filter((i) => i.result === 'fail').length;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {inspection.component_type} Inspection
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDate(inspection.created_at)} · {passCount} pass · {failCount} fail
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={inspection.completed ? 'Completed' : 'In Progress'}
              size="small"
              color={inspection.completed ? 'success' : 'warning'}
              variant={inspection.completed ? 'filled' : 'outlined'}
            />
            {!readOnly && (
              <IconButton size="small" color="error" onClick={remove}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2}>
          {items.map((item) => (
            <Box key={item.id}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1}
              >
                <Typography sx={{ flex: 1 }}>{item.label}</Typography>
                {readOnly ? (
                  <ResultBadge result={item.result} />
                ) : (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={item.result || null}
                    onChange={(_, v) => v && setResult(item.id, v)}
                  >
                    <ToggleButton value="pass" color="success">
                      Pass
                    </ToggleButton>
                    <ToggleButton value="fail" color="error">
                      Fail
                    </ToggleButton>
                    <ToggleButton value="na">N/A</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>
              {readOnly ? (
                item.notes ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {item.notes}
                  </Typography>
                ) : null
              ) : (
                <TextField
                  placeholder="Notes…"
                  size="small"
                  fullWidth
                  value={item.notes || ''}
                  onChange={(e) => setNotes(item.id, e.target.value)}
                  sx={{ mt: 1 }}
                />
              )}
              <Divider sx={{ mt: 2 }} />
            </Box>
          ))}
        </Stack>

        {!readOnly && (
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button onClick={() => save()} disabled={saving || !dirty}>
              Save
            </Button>
            <Button
              variant="contained"
              color={inspection.completed ? 'inherit' : 'success'}
              onClick={() => save(!inspection.completed)}
              disabled={saving}
            >
              {inspection.completed ? 'Reopen' : 'Mark Complete'}
            </Button>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Photos ---------------- */
function PhotosTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [category, setCategory] = useState('general');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        await uploadPhotos(job.id, files, category, caption || undefined);
        setCaption('');
        await onUpdate();
      } catch (e) {
        setError(apiError(e, 'Failed to upload photos'));
      } finally {
        setUploading(false);
      }
    },
    [job.id, category, caption, onUpdate, setError],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    onDrop: doUpload,
    disabled: uploading,
  });

  const onCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) doUpload(Array.from(e.target.files));
  };

  const removePhoto = async (photoId: number) => {
    try {
      await deletePhoto(job.id, photoId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete photo'));
    }
  };

  const before = job.photos.filter((p) => p.category === 'before');
  const after = job.photos.filter((p) => p.category === 'after');
  const general = job.photos.filter((p) => p.category !== 'before' && p.category !== 'after');

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                select
                label="Category"
                size="small"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="before">Before</MenuItem>
                <MenuItem value="after">After</MenuItem>
                <MenuItem value="general">General</MenuItem>
              </TextField>
              <TextField
                label="Caption (optional)"
                size="small"
                fullWidth
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <Button
                component="label"
                variant="outlined"
                startIcon={<PhotoCameraIcon />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={onCameraInput}
                />
              </Button>
            </Stack>
            <Box
              {...getRootProps()}
              sx={{
                border: '2px dashed',
                borderColor: isDragActive ? 'primary.main' : 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                bgcolor: isDragActive ? 'action.hover' : 'transparent',
              }}
            >
              <input {...getInputProps()} />
              <CloudUploadIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>
                {uploading
                  ? 'Uploading…'
                  : isDragActive
                    ? 'Drop photos here'
                    : 'Drag & drop photos, or click to browse'}
              </Typography>
            </Box>
          </CardContent>
        </Card>

      <Stack spacing={3}>
        <PhotoSection title="Before" photos={before} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
        <PhotoSection title="After" photos={after} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
        <PhotoSection title="General" photos={general} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
      </Stack>
    </Box>
  );
}

function PhotoSection({
  title,
  photos,
  jobId,
  canDelete,
  onDelete,
}: {
  title: string;
  photos: JobDetailT['photos'];
  jobId: number;
  canDelete: boolean;
  onDelete: (id: number) => void;
}) {
  if (!photos.length) return null;
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        {title} ({photos.length})
      </Typography>
      <PhotoGallery jobId={jobId} photos={photos} canDelete={canDelete} onDelete={onDelete} />
    </Box>
  );
}

/* ---------------- Documents ---------------- */
function DocumentsTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    try {
      await uploadDocuments(job.id, Array.from(e.target.files));
      await onUpdate();
    } catch (err) {
      setError(apiError(err, 'Failed to upload documents'));
    } finally {
      setUploading(false);
    }
  };

  const open = async (filename: string) => {
    try {
      const url = await fetchFileBlob(job.id, filename);
      window.open(url, '_blank');
    } catch (e) {
      setError(apiError(e, 'Failed to open document'));
    }
  };

  const remove = async (docId: number) => {
    try {
      await deleteDocument(job.id, docId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete document'));
    }
  };

  return (
    <Box>
      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button component="label" variant="contained" startIcon={<CloudUploadIcon />}>
            {uploading ? 'Uploading…' : 'Upload Documents'}
            <input type="file" multiple hidden onChange={onFiles} />
          </Button>
        </Stack>
      )}
      {job.documents.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No documents" subtitle="Quotes, drawings and reports appear here." />
        </Card>
      ) : (
        <Card>
          <Table>
            <TableBody>
              {job.documents.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell sx={{ width: 40 }}>
                    <DescriptionIcon color="action" />
                  </TableCell>
                  <TableCell>{d.original_name || d.filename}</TableCell>
                  <TableCell>{fmtDate(d.created_at)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => open(d.filename)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {!readOnly && (
                      <IconButton size="small" color="error" onClick={() => remove(d.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Box>
  );
}

/* ---------------- Notes ---------------- */
function NotesTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  // Clients may post customer-facing notes only; staff get the full set.
  const noteTypeOptions = readOnly
    ? NOTE_TYPES.filter((t) => t.value === 'customer' || t.value === 'query')
    : NOTE_TYPES;
  const [noteType, setNoteType] = useState(readOnly ? 'customer' : 'internal');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  // Clients cannot see internal notes (backend also enforces); filter defensively.
  const visible = useMemo(
    () => (readOnly ? job.notes.filter((n) => n.note_type !== 'internal') : job.notes),
    [job.notes, readOnly],
  );

  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await addNote(job.id, noteType, body.trim());
      setBody('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to add note'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Type"
                size="small"
                value={noteType}
                onChange={(e) => setNoteType(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                {noteTypeOptions.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Note"
                size="small"
                fullWidth
                multiline
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Stack>
            <Stack direction="row" justifyContent="flex-end">
              <Button variant="contained" onClick={submit} disabled={saving || !body.trim()}>
                Add Note
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No notes yet" />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {visible.map((n) => {
            const color = NOTE_COLORS[n.note_type] || '#64748b';
            return (
              <Card key={n.id} sx={{ borderLeft: `3px solid ${color}` }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Chip
                      label={NOTE_TYPES.find((t) => t.value === n.note_type)?.label || n.note_type}
                      size="small"
                      sx={{ bgcolor: `${color}22`, color, fontWeight: 600 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {n.author_name || 'System'} · {fmtDate(n.created_at)}
                    </Typography>
                  </Stack>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>{n.body}</Typography>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

/* ---------------- Check-In QR ---------------- */
function CheckInTab({ job, onUpdate }: { job: JobDetailT; onUpdate: () => Promise<void> }) {
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    getCheckin(job.id)
      .then((s) => {
        setStatus(s);
        // If the job has just been checked in but the parent job detail still
        // thinks it hasn't, refresh it so the Final Inspection submit unlocks.
        if (s.checked_in && !job.checked_in) {
          void onUpdate();
        }
      })
      .catch((e) => setErr(apiError(e, 'Failed to load check-in')))
      .finally(() => setLoading(false));
  }, [job.id, job.checked_in, onUpdate]);

  useEffect(() => {
    load();
  }, [load]);

  const download = () => {
    if (!status) return;
    const a = document.createElement('a');
    a.href = status.qr_png;
    a.download = `checkin-${job.job_number}.png`;
    a.click();
  };

  const print = () => {
    if (!status) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const stamped = status.checked_in;
    const qrBlock = stamped
      ? `<div style="position:relative;display:inline-block">` +
        `<img src="${status.qr_png}" style="width:300px;height:300px;filter:grayscale(1) opacity(0.3)"/>` +
        `<div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center">` +
        `<div style="transform:rotate(-9deg);background:#2e7d32;color:#fff;font-weight:800;` +
        `letter-spacing:2px;font-size:26px;padding:12px 40px;border:3px solid #fff;` +
        `box-shadow:0 6px 18px rgba(0,0,0,0.3);white-space:nowrap">CHECKED IN</div>` +
        `</div></div>`
      : `<img src="${status.qr_png}" style="width:300px;height:300px"/>`;
    w.document.write(
      `<html><head><title>Check-in ${job.job_number}</title></head>` +
        `<body style="text-align:center;font-family:sans-serif;padding:40px;color:#111">` +
        `<h2 style="margin:0 0 4px">${job.job_number}</h2>` +
        `<div style="color:#555;margin-bottom:20px">${job.customer_name}</div>` +
        qrBlock +
        `<p style="font-size:13px;color:#555;margin-top:16px">` +
        (stamped ? 'Already checked in · WorkshopIQ' : 'Scan to check in · WorkshopIQ') +
        `</p>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  // Check-in only opens once a (normal) inspection has been completed. Jobs
  // already checked in fall through so their status still shows.
  const inspectionDone = job.inspections.some((i) => i.completed);
  if (!inspectionDone && !job.checked_in)
    return (
      <Card sx={{ p: 3 }}>
        <Stack spacing={2} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center">
            <QrCode2Icon color="disabled" />
            <Typography variant="h6" fontWeight={700}>
              Check-In QR
            </Typography>
          </Stack>
          <Alert severity="info" variant="outlined" sx={{ width: '100%' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              Inspection not completed yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The check-in QR code becomes available once this job's inspection has
              been completed. Mark the inspection complete on the Inspections tab,
              and the QR will appear here.
            </Typography>
          </Alert>
        </Stack>
      </Card>
    );

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );

  if (err || !status)
    return (
      <Card sx={{ p: 2 }}>
        <Alert severity="error">{err || 'No check-in available.'}</Alert>
      </Card>
    );

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <QrCode2Icon color="primary" />
              <Typography variant="h6" fontWeight={700}>
                Check-In QR
              </Typography>
            </Stack>
            <Box
              sx={{
                bgcolor: '#fff',
                borderRadius: 2,
                p: 2,
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 260,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <img
                  src={status.qr_png}
                  alt="Check-in QR code"
                  style={{
                    width: '100%',
                    maxWidth: 260,
                    imageRendering: 'pixelated',
                    // Dim + desaturate the code once it's used so it's obviously
                    // not meant to be scanned again.
                    filter: status.checked_in ? 'grayscale(1) opacity(0.3)' : 'none',
                  }}
                />
                {status.checked_in && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <Box
                      sx={{
                        width: '135%',
                        transform: 'rotate(-9deg)',
                        bgcolor: 'success.main',
                        color: '#fff',
                        py: 1.25,
                        px: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        border: '2px solid rgba(255,255,255,0.9)',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
                      }}
                    >
                      <CheckCircleIcon sx={{ fontSize: 26 }} />
                      <Typography
                        sx={{
                          fontWeight: 900,
                          letterSpacing: 1.5,
                          fontSize: { xs: 18, sm: 22 },
                          lineHeight: 1,
                        }}
                      >
                        CHECKED IN
                      </Typography>
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1.5, wordBreak: 'break-all', fontFamily: 'monospace' }}
            >
              {status.url}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={download} fullWidth>
                Download
              </Button>
              <Button variant="outlined" startIcon={<PrintIcon />} onClick={print} fullWidth>
                Print
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="h6" fontWeight={700}>
                Status
              </Typography>
              <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
                Refresh
              </Button>
            </Stack>

            {status.checked_in ? (
              <Box>
                <Chip label="Checked in" color="success" sx={{ mb: 2, fontWeight: 600 }} />
                <Table size="small">
                  <TableBody>
                    <Row label="Operator" value={status.operator_name} />
                    <Row label="Machine" value={status.machine} />
                    <Row
                      label="Checked in"
                      value={status.checked_in_at ? fmtDate(status.checked_in_at) : '—'}
                    />
                  </TableBody>
                </Table>
              </Box>
            ) : (
              <Box>
                <Chip label="Awaiting check-in" sx={{ mb: 2, fontWeight: 600 }} />
                <Typography variant="body2" color="text.secondary">
                  Print the QR and place it on the machine or job. The first person to scan it and
                  submit the form will be recorded here — and the code then locks (one-time).
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/* ---------------- Timeline ---------------- */
function TimelineTab({ job }: { job: JobDetailT }) {
  if (!job.timeline.length)
    return (
      <Card sx={{ p: 2 }}>
        <EmptyState title="No activity yet" />
      </Card>
    );
  return (
    <Card>
      <CardContent>
        <Stack spacing={0}>
          {job.timeline.map((ev, idx) => (
            <Stack key={ev.id} direction="row" spacing={2}>
              <Stack alignItems="center">
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'primary.main', mt: 0.5 }} />
                {idx < job.timeline.length - 1 && (
                  <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />
                )}
              </Stack>
              <Box sx={{ pb: 3 }}>
                <Typography fontWeight={600}>{ev.description}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {ev.actor_name || 'System'} · {fmtDate(ev.created_at)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ---------------- Final Inspection ---------------- */
function InspectionReport({ job }: { job: JobDetailT }) {
  const fi = job.final_inspection || null;
  const log = fi?.attempts_log || [];
  const photos = job.photos || [];
  if (!log.length && !photos.length) return null;
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6" fontWeight={800}>
            Inspection Report
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Full history of this job's final inspection — every attempt, in order,
            with the photos on record.
          </Typography>
          <Divider />
          {log.length > 0 && (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
              {log.map((a) => {
                const failed = a.result === 'failed';
                return (
                  <Box
                    key={a.id}
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: failed ? 'error.main' : 'success.main',
                      bgcolor: failed ? 'rgba(244,63,94,0.06)' : 'rgba(34,197,94,0.06)',
                    }}
                  >
                    <Box sx={{ minWidth: 78 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Attempt {a.attempt_number}
                      </Typography>
                      <Chip
                        label={failed ? 'Failed' : 'Passed'}
                        size="small"
                        color={failed ? 'error' : 'success'}
                        sx={{ fontWeight: 700, mt: 0.25 }}
                      />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {failed && a.reason && (
                        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{a.reason}</Typography>
                      )}
                      {!failed && (
                        <Typography color="text.secondary">
                          Signed off{a.internal_reference ? ` · ref ${a.internal_reference}` : ''}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {a.inspector_name || '—'} · {fmtDate(a.created_at)}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          )}
          {photos.length > 0 && (
            <>
              {log.length > 0 && <Divider sx={{ mt: 0.5 }} />}
              <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5 }}>
                Photos ({photos.length})
              </Typography>
              <PhotoGallery jobId={job.id} photos={photos} canDelete={false} />
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FinalInspectionTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const fi = job.final_inspection || null;
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [failing, setFailing] = useState(false);
  const [busy, setBusy] = useState(false);

  const release = async () => {
    setBusy(true);
    try {
      await releaseFinalInspection(job.id);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not release final inspection'));
    } finally {
      setBusy(false);
    }
  };

  const submitPass = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await submitFinalInspection(job.id, {
        inspector_name: name.trim(),
        internal_reference: reference.trim() || undefined,
      });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not submit final inspection'));
    } finally {
      setBusy(false);
    }
  };

  const submitFail = async () => {
    if (!name.trim() || !reason.trim()) return;
    setBusy(true);
    try {
      await failFinalInspection(job.id, {
        inspector_name: name.trim(),
        reason: reason.trim(),
      });
      setFailing(false);
      setReason('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not record the failed inspection'));
    } finally {
      setBusy(false);
    }
  };

  let content: JSX.Element;

  if (fi?.completed) {
    // ---- Passed ----
    content = (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip label="Passed" color="success" size="small" />
            </Stack>
            <Divider />
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Inspector
              </Typography>
              <Typography>{fi.inspector_name || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Internal reference
              </Typography>
              <Typography>{fi.internal_reference || '—'}</Typography>
            </Box>
            {fi.attempts > 0 && (
              <Typography variant="caption" color="text.secondary">
                Passed after {fi.attempts} failed{' '}
                {fi.attempts === 1 ? 'inspection' : 'inspections'}.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Submitted{fi.completed_at ? ` · ${fmtDate(fi.completed_at)}` : ''}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  } else if (fi && fi.result === 'failed') {
    // ---- Failed — awaiting workshop fix + re-inspection ----
    content = (
      <Card sx={{ borderColor: 'error.main' }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip label="Failed" color="error" size="small" />
            </Stack>
            <Alert severity="error" variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Reason for failure
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {fi.failure_reason || '—'}
              </Typography>
            </Alert>
            <Typography variant="caption" color="text.secondary">
              Failed by {fi.inspector_name || 'client'}
              {fi.failed_at ? ` · ${fmtDate(fi.failed_at)}` : ''} · attempt {fi.attempts}
            </Typography>
            <Divider />
            {readOnly ? (
              <Typography color="text.secondary">
                You marked this inspection as failed. The workshop has been notified
                and will address the issue before sending it back for re-inspection.
              </Typography>
            ) : (
              <>
                <Typography color="text.secondary">
                  Address the issue above, then send the job back for re-inspection.
                  This returns it to the Inspection stage and re-opens the sign-off
                  form for the client.
                </Typography>
                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={release}
                    disabled={busy}
                  >
                    {busy ? 'Sending…' : 'Send for re-inspection'}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  } else if (fi) {
    // ---- Released, awaiting client sign-off (pending / re-inspection) ----
    const isReinspection = fi.attempts > 0;
    if (readOnly) {
      content = (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              {isReinspection && fi.failure_reason && (
                <Alert severity="warning" variant="outlined">
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    Re-inspection · previous failure
                  </Typography>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                    {fi.failure_reason}
                  </Typography>
                </Alert>
              )}
              <Typography color="text.secondary">
                Confirm the final inspection for this job. Enter the inspector's name,
                then pass it or, if there's a problem, fail it with a reason.
              </Typography>
              <TextField
                label="Inspector name & surname"
                size="small"
                fullWidth
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {!failing && (
                <TextField
                  label="Internal reference (optional)"
                  size="small"
                  fullWidth
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              )}
              {failing && (
                <TextField
                  label="Reason for failure"
                  size="small"
                  fullWidth
                  required
                  multiline
                  minRows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe what failed so the workshop can fix it"
                />
              )}
              {!failing ? (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => setFailing(true)}
                    disabled={busy}
                  >
                    Fail inspection
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={submitPass}
                    disabled={busy || !name.trim()}
                  >
                    {busy ? 'Submitting…' : 'Pass inspection'}
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    variant="text"
                    onClick={() => {
                      setFailing(false);
                      setReason('');
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={submitFail}
                    disabled={busy || !name.trim() || !reason.trim()}
                  >
                    {busy ? 'Submitting…' : 'Submit failed inspection'}
                  </Button>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      );
    } else {
      content = (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip
                label={`${
                  isReinspection
                    ? 'Awaiting client re-inspection'
                    : 'Awaiting client final inspection'
                } · released ${fmtDate(fi.requested_at)}`}
                variant="outlined"
              />
              {isReinspection && fi.failure_reason && (
                <Typography variant="body2" color="text.secondary">
                  Last failure: {fi.failure_reason}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      );
    }
  } else {
    // ---- Not yet released ----
    content = (
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="h6" fontWeight={800}>
              Final Inspection
            </Typography>
            {readOnly ? (
              <Typography color="text.secondary">
                The final inspection isn't available yet. It will appear here once the
                workshop releases it.
              </Typography>
            ) : !job.checked_in ? (
              <Alert severity="info" variant="outlined" sx={{ width: '100%' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Awaiting check-in
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  The final inspection can only be submitted once the job's QR code has
                  been scanned and the job is checked in. Print the QR from the Check-In
                  tab and have it scanned on the machine first.
                </Typography>
              </Alert>
            ) : (
              <>
                <Typography color="text.secondary">
                  Submitting the final inspection moves this job to the Inspection stage
                  and makes the sign-off form available to the assigned client. They can
                  pass it or fail it with a reason; the customer review unlocks only once
                  it passes.
                </Typography>
                <Button variant="contained" onClick={release} disabled={busy}>
                  {busy ? 'Submitting…' : 'Submit final inspection'}
                </Button>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2.5}>
      {content}
      <InspectionReport job={job} />
    </Stack>
  );
}

/* ---------------- Customer Review ---------------- */
function ReviewTab({
  job,
  readOnly,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  setError: (s: string) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // A review can only be requested once the final inspection is complete.
  const finalDone = !!job.final_inspection?.completed;

  const load = useCallback(() => {
    setLoading(true);
    return getReview(job.id)
      .then((r) => setReview(r))
      .catch((e) => setError(apiError(e, 'Failed to load review')))
      .finally(() => setLoading(false));
  }, [job.id, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRequest = async () => {
    setBusy(true);
    try {
      const r = await requestReview(job.id);
      setReview(r);
    } catch (e) {
      setError(apiError(e, 'Could not request review'));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );

  // Completed — show the result to everyone
  if (review?.completed) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Customer Review
              </Typography>
              <Chip label="Completed" color="success" size="small" />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Rating value={review.rating || 0} readOnly />
              <Typography fontWeight={700}>{review.rating}/5</Typography>
            </Stack>
            <Divider />
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                What they were happy with
              </Typography>
              <Typography>{review.feedback || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                How we could improve
              </Typography>
              <Typography>{review.improvement || '—'}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Submitted by {review.reviewer_name || 'client'}
              {review.completed_at ? ` · ${fmtDate(review.completed_at)}` : ''}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  // Requested but not completed
  if (review) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="h6" fontWeight={800}>
              Customer Review
            </Typography>
            {readOnly ? (
              <>
                <Typography color="text.secondary">
                  Please leave a rating for this job. Your feedback helps us improve.
                </Typography>
                <Button variant="contained" onClick={() => setDialogOpen(true)}>
                  Leave review
                </Button>
              </>
            ) : (
              <Chip label={`Awaiting client review · requested ${fmtDate(review.requested_at)}`} variant="outlined" />
            )}
          </Stack>
        </CardContent>
        <ReviewDialog
          open={dialogOpen}
          jobId={job.id}
          jobNumber={job.job_number}
          customerName={job.customer_name}
          onClose={() => setDialogOpen(false)}
          onSubmitted={load}
        />
      </Card>
    );
  }

  // No review yet
  return (
    <Card>
      <CardContent>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h6" fontWeight={800}>
            Customer Review
          </Typography>
          {readOnly ? (
            <Typography color="text.secondary">
              No review has been requested for this job yet.
            </Typography>
          ) : (
            <>
              <Typography color="text.secondary">
                Request a satisfaction review from the assigned client. They'll be
                prompted to rate this job every time they log in until they submit.
              </Typography>
              {!finalDone && (
                <Typography variant="body2" color="text.secondary">
                  The final inspection must be completed before a review can be requested.
                </Typography>
              )}
              <Button
                variant="contained"
                onClick={handleRequest}
                disabled={busy || !finalDone}
              >
                {busy ? 'Requesting…' : 'Request customer review'}
              </Button>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ---------------- Costing (staff & admin only) ---------------- */
function CostingTab({
  job,
  setError,
}: {
  job: JobDetailT;
  setError: (s: string) => void;
}) {
  const [items, setItems] = useState<JobCostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ description: '', supplier: '', quantity: '1', unit_cost: '' });

  const load = useCallback(() => {
    setLoading(true);
    listCostItems(job.id)
      .then(setItems)
      .catch((e) => setError(apiError(e, 'Failed to load costing')))
      .finally(() => setLoading(false));
  }, [job.id, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + (i.line_total || 0), 0),
    [items],
  );

  const add = async () => {
    if (!form.description.trim()) return;
    setSaving(true);
    try {
      await addCostItem(job.id, {
        description: form.description.trim(),
        supplier: form.supplier.trim() || undefined,
        quantity: Number(form.quantity) || 0,
        unit_cost: Number(form.unit_cost) || 0,
      });
      setForm({ description: '', supplier: '', quantity: '1', unit_cost: '' });
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to add cost line'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteCostItem(job.id, id);
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete cost line'));
    }
  };

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <LockOutlinedIcon fontSize="small" color="disabled" />
            <Typography variant="body2" color="text.secondary">
              Internal supplier costing — visible to staff and administrators only. Clients never see this tab.
            </Typography>
          </Stack>
          <Grid container spacing={2} alignItems="flex-end">
            <Grid item xs={12} sm={4}>
              <TextField
                label="Description"
                size="small"
                fullWidth
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="Supplier"
                size="small"
                fullWidth
                value={form.supplier}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField
                label="Qty"
                size="small"
                type="number"
                fullWidth
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField
                label="Unit cost (R)"
                size="small"
                type="number"
                fullWidth
                value={form.unit_cost}
                onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={1}>
              <Button
                variant="contained"
                fullWidth
                onClick={add}
                disabled={saving || !form.description.trim()}
                sx={{ height: 40 }}
              >
                Add
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : items.length === 0 ? (
            <EmptyState title="No costing lines yet" subtitle="Add your supplier costs above." />
          ) : (
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary' }}>Description</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>Supplier</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Qty</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Unit</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Line total</TableCell>
                  <TableCell />
                </TableRow>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.description}</TableCell>
                    <TableCell>{i.supplier || '—'}</TableCell>
                    <TableCell align="right">{i.quantity}</TableCell>
                    <TableCell align="right">{fmtMoney(i.unit_cost)}</TableCell>
                    <TableCell align="right">{fmtMoney(i.line_total)}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => remove(i.id)} aria-label="Delete cost line">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} sx={{ border: 0 }} />
                  <TableCell align="right" sx={{ border: 0, fontWeight: 700, fontSize: '1rem' }}>
                    {fmtMoney(total)}
                  </TableCell>
                  <TableCell sx={{ border: 0 }} />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/* ---------------- Client Access (staff & admin) ---------------- */
function ClientAccessTab({
  job,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [clients, setClients] = useState<User[]>([]);
  const [selected, setSelected] = useState<number[]>(job.client_user_ids);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listClients()
      .then(setClients)
      .catch((e) => setError(apiError(e, 'Failed to load clients')));
  }, [setError]);

  useEffect(() => {
    setSelected(job.client_user_ids);
  }, [job.client_user_ids]);

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    setSaving(true);
    try {
      await assignClients(job.id, selected);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to assign clients'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          Client Access
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Selected client users can view this job in their portal. They see status, progress,
          customer-facing notes, photos and documents — but cannot edit.
        </Typography>
        {clients.length === 0 ? (
          <EmptyState title="No client users" subtitle="Create client users on the Users page first." />
        ) : (
          <Stack>
            {clients.map((c) => (
              <FormControlLabel
                key={c.id}
                control={<Checkbox checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />}
                label={
                  <span>
                    {c.full_name || c.username}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      ({c.username})
                    </Typography>
                  </span>
                }
              />
            ))}
          </Stack>
        )}
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Access'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
