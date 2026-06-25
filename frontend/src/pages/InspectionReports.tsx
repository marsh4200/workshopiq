import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode2';
import PrintIcon from '@mui/icons-material/Print';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import WorkIcon from '@mui/icons-material/Engineering';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  deleteInspectionReport,
  generateInspectionReport,
  inspectionReportFormUrl,
  listInspectionReports,
  listJobs,
  openBlankInspectionReport,
} from '../api/client';
import { PageHeader, EmptyState, fmtDate } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { InspectionReportDetail, InspectionReportItem, JobListItem } from '../types';

function StatusChip({ submitted }: { submitted: boolean }) {
  const color = submitted ? '#22c55e' : '#f59e0b';
  return (
    <Chip
      label={submitted ? 'Filed' : 'Pending'}
      size="small"
      sx={{ bgcolor: `${color}1f`, color, fontWeight: 600, borderRadius: 1 }}
    />
  );
}

export default function InspectionReports() {
  const { isAdmin } = useAuth();
  const isMobile = useDeviceType().isMobile;
  const navigate = useNavigate();

  const [reports, setReports] = useState<InspectionReportItem[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [job, setJob] = useState<JobListItem | null>(null);
  const [generating, setGenerating] = useState(false);
  const [qr, setQr] = useState<InspectionReportDetail | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await listInspectionReports());
    } catch (e) {
      setToast(apiError(e, 'Could not load reports'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    listJobs().then(setJobs).catch(() => undefined);
  }, [load]);

  const handleGenerate = async () => {
    if (!job) return;
    setGenerating(true);
    try {
      const detail = await generateInspectionReport(job.id);
      setQr(detail);
      setGenOpen(false);
      setJob(null);
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not generate report'));
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => setToast('Link copied'),
      () => setToast('Copy failed'),
    );
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInspectionReport(id);
      setToast('Pending report removed');
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not remove'));
    }
  };

  const pendingCount = useMemo(() => reports.filter((r) => !r.submitted).length, [reports]);

  return (
    <Box>
      <PageHeader
        eyebrow="Quality"
        title="Inspection Reports"
        subtitle="Generate a QR per job. Scan it to fill the Everton report online — it files straight to the job's documents."
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={() => openBlankInspectionReport().catch((e) => setToast(apiError(e)))}
            >
              Print blank
            </Button>
            <Button variant="contained" startIcon={<QrCodeIcon />} onClick={() => setGenOpen(true)}>
              Generate QR
            </Button>
          </>
        }
      />

      {pendingCount > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {pendingCount} pending · {reports.length - pendingCount} filed
        </Typography>
      )}

      <Card sx={{ p: { xs: 1.5, sm: 0 } }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={<FactCheckIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title="No inspection reports yet"
            subtitle="Generate a QR code for a job to get started."
          />
        ) : isMobile ? (
          <Stack spacing={1.5} sx={{ p: 0.5 }}>
            {reports.map((r) => (
              <Card key={r.id} variant="outlined" sx={{ p: 1.75 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 700 }}>{r.certificate_number}</Typography>
                  <StatusChip submitted={r.submitted} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {r.job_number} · {r.customer_name}
                </Typography>
                {r.submitted ? (
                  <Typography variant="caption" color="text.secondary">
                    {r.inspector_name} · {fmtDate(r.submitted_at)}
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Created {fmtDate(r.created_at)}
                  </Typography>
                )}
                <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                  {r.submitted ? (
                    <Button size="small" startIcon={<WorkIcon />} onClick={() => navigate(`/jobs/${r.job_id}`)}>
                      Open job
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="small"
                        startIcon={<QrCodeIcon />}
                        onClick={() =>
                          setQr({
                            ...r,
                            url: inspectionReportFormUrl(r.token),
                            qr_png: '',
                          } as InspectionReportDetail)
                        }
                      >
                        QR
                      </Button>
                      <Button
                        size="small"
                        startIcon={<OpenInNewIcon />}
                        onClick={() => window.open(inspectionReportFormUrl(r.token), '_blank')}
                      >
                        Fill
                      </Button>
                      {isAdmin && (
                        <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </>
                  )}
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Certificate</TableCell>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Inspector</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.certificate_number}</TableCell>
                  <TableCell>
                    {r.job_number}
                    <Typography variant="caption" display="block" color="text.secondary">
                      {r.customer_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip submitted={r.submitted} />
                  </TableCell>
                  <TableCell>{r.inspector_name || '—'}</TableCell>
                  <TableCell>{fmtDate(r.submitted_at || r.created_at)}</TableCell>
                  <TableCell align="right">
                    {r.submitted ? (
                      <Tooltip title="Open job (report is in documents)">
                        <IconButton size="small" onClick={() => navigate(`/jobs/${r.job_id}`)}>
                          <WorkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <>
                        <Tooltip title="Show QR code">
                          <IconButton
                            size="small"
                            onClick={() =>
                              setQr({
                                ...r,
                                url: inspectionReportFormUrl(r.token),
                                qr_png: '',
                              } as InspectionReportDetail)
                            }
                          >
                            <QrCodeIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Fill on screen">
                          <IconButton
                            size="small"
                            onClick={() => window.open(inspectionReportFormUrl(r.token), '_blank')}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {isAdmin && (
                          <Tooltip title="Remove pending report">
                            <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Generate dialog */}
      <Dialog open={genOpen} onClose={() => setGenOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Generate inspection report QR</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pick the job this report belongs to. A new certificate number is assigned
            automatically, and the QR files the completed report into that job's documents.
          </Typography>
          <Autocomplete
            options={jobs}
            value={job}
            onChange={(_, v) => setJob(v)}
            getOptionLabel={(j) => `${j.job_number} · ${j.customer_name}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Job" autoFocus />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!job || generating} onClick={handleGenerate}>
            {generating ? 'Generating…' : 'Generate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR result dialog */}
      <Dialog open={!!qr} onClose={() => setQr(null)} fullWidth maxWidth="xs">
        <DialogTitle>{qr?.certificate_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {qr?.job_number} · {qr?.customer_name}
          </Typography>
          {qr?.qr_png ? (
            <Box
              component="img"
              src={qr.qr_png}
              alt="QR code"
              sx={{ width: '100%', maxWidth: 260, display: 'block', mx: 'auto', borderRadius: 2, bgcolor: '#fff', p: 1 }}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Open the link below to fill in the report.
              </Typography>
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{ display: 'block', mt: 2, wordBreak: 'break-all', color: 'text.secondary' }}
          >
            {qr?.url}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              onClick={() => qr && window.open(qr.url, '_blank')}
            >
              Fill on screen
            </Button>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => qr && copyLink(qr.url)}>
              Copy link
            </Button>
            <Button
              size="small"
              startIcon={<PrintIcon />}
              onClick={() => openBlankInspectionReport().catch((e) => setToast(apiError(e)))}
            >
              Print blank
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQr(null)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
