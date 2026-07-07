import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import StarBorderIcon from '@mui/icons-material/StarBorderPurple500';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import WorkIcon from '@mui/icons-material/Engineering';
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardIos';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  getPendingReviews,
  listJobs,
  listMyInspectionReports,
  signInspectionReport,
} from '../api/client';
import { EmptyState, PageHeader, StatusBadge, fmtDay } from '../components/common';
import SignaturePad from '../components/SignaturePad';
import ReviewDialog from '../components/ReviewDialog';
import { useAuth } from '../context/AuthContext';
import { fontMono } from '../theme/theme';
import type { InspectionReportItem, JobListItem, PendingReview } from '../types';

const SIGN_COLOR = '#f59e0b';
const REVIEW_COLOR = '#3b82f6';

/** One-line human description of a job from the list payload we already have. */
function jobBlurb(j: JobListItem): string {
  const bits: string[] = [];
  if (j.component_type) bits.push(j.component_type);
  if (j.quantity && j.quantity > 1) bits.push(`Qty ${j.quantity}`);
  if (!bits.length && j.po_number) bits.push(`PO ${j.po_number}`);
  return bits.join(' · ') || 'Workshop job';
}

/**
 * Client landing page. Built around two questions the client actually has:
 * "what needs me?" (sign a report, leave a review) and "how's my job going?".
 * The first is answered by the summary cards up top; the second by the job
 * folders below — collapsed by default, each opening to that job's reports,
 * review action and a link into the full job.
 */
export default function ClientHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [reports, setReports] = useState<InspectionReportItem[]>([]);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState('');

  // Sign dialog
  const [signTarget, setSignTarget] = useState<InspectionReportItem | null>(null);
  const [signName, setSignName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // Review dialog
  const [reviewTarget, setReviewTarget] = useState<PendingReview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, r, pr] = await Promise.all([
        listJobs(),
        listMyInspectionReports(),
        getPendingReviews(),
      ]);
      setJobs(j);
      setReports(r);
      setPendingReviews(pr);
    } catch (e) {
      setToast(apiError(e, 'Could not load your workshop'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reportsByJob = useMemo(() => {
    const m = new Map<number, InspectionReportItem[]>();
    for (const r of reports) {
      const arr = m.get(r.job_id) || [];
      arr.push(r);
      m.set(r.job_id, arr);
    }
    return m;
  }, [reports]);

  const reviewByJob = useMemo(() => {
    const m = new Map<number, PendingReview>();
    for (const p of pendingReviews) m.set(p.job_id, p);
    return m;
  }, [pendingReviews]);

  const signCount = useMemo(() => reports.filter((r) => !r.client_signed).length, [reports]);
  const reviewCount = pendingReviews.length;

  const jobHasSign = (id: number) => (reportsByJob.get(id) || []).some((r) => !r.client_signed);
  const jobHasReview = (id: number) => reviewByJob.has(id);
  const jobNeedsAction = (id: number) => jobHasSign(id) || jobHasReview(id);

  const { active, closed } = useMemo(() => {
    const a = jobs.filter((j) => j.status !== 'Closed');
    const c = jobs.filter((j) => j.status === 'Closed');
    // Float jobs that need the client's attention to the top of the active list.
    a.sort((x, y) => Number(jobNeedsAction(y.id)) - Number(jobNeedsAction(x.id)));
    return { active: a, closed: c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, reportsByJob, reviewByJob]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openSign = (r: InspectionReportItem) => {
    setSignTarget(r);
    setSignName((user?.full_name || '').trim());
    setSignature(null);
    setPadKey((k) => k + 1);
  };

  const submitSign = async () => {
    if (!signTarget) return;
    const typed = signName.trim();
    if (!typed && !signature) {
      setToast('Type your name or draw your signature');
      return;
    }
    setSaving(true);
    try {
      await signInspectionReport(signTarget.id, { signed_name: typed, signature_png: signature });
      setToast(`${signTarget.certificate_number} signed`);
      setSignTarget(null);
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not submit signature'));
    } finally {
      setSaving(false);
    }
  };

  const firstName = (user?.full_name || user?.username || '').split(' ')[0];

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );

  const totalAction = signCount + reviewCount;

  const NeedsCard = ({
    color,
    icon,
    count,
    label,
    caption,
    to,
  }: {
    color: string;
    icon: React.ReactNode;
    count: number;
    label: string;
    caption: string;
    to: string;
  }) => {
    const active = count > 0;
    return (
      <Card
        sx={{
          bgcolor: active ? `${color}14` : 'transparent',
          borderColor: active ? `${color}55` : undefined,
          '&:hover': { borderColor: `${color}66` },
        }}
      >
        <CardActionArea onClick={() => navigate(to)} sx={{ borderRadius: 'inherit' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                color: active ? color : 'text.disabled',
                bgcolor: active ? `${color}1f` : 'action.hover',
                '& svg': { fontSize: 24 },
              }}
            >
              {active ? icon : <CheckCircleOutlineIcon />}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {active ? `${count} ${label}` : `No ${label}`}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {active ? caption : "You're all caught up"}
              </Typography>
            </Box>
            <ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
          </Box>
        </CardActionArea>
      </Card>
    );
  };

  const JobFolder = ({ job }: { job: JobListItem }) => {
    const isOpen = open.has(job.id);
    const jobReports = reportsByJob.get(job.id) || [];
    const needsSign = jobHasSign(job.id);
    const needsReview = jobHasReview(job.id);
    const review = reviewByJob.get(job.id);

    return (
      <Card
        variant="outlined"
        sx={{
          overflow: 'hidden',
          borderColor: needsSign
            ? `${SIGN_COLOR}66`
            : needsReview
              ? `${REVIEW_COLOR}66`
              : undefined,
        }}
      >
        <Box
          onClick={() => toggle(job.id)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.5,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ color: isOpen ? 'primary.main' : 'text.secondary', display: 'grid', placeItems: 'center' }}>
            {isOpen ? <FolderOpenOutlinedIcon /> : <FolderOutlinedIcon />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: fontMono, fontWeight: 700 }} noWrap>
                {job.job_number}
              </Typography>
              {needsSign && (
                <Chip
                  size="small"
                  label="Sign"
                  sx={{ height: 20, bgcolor: `${SIGN_COLOR}1f`, color: SIGN_COLOR, fontWeight: 700 }}
                />
              )}
              {needsReview && (
                <Chip
                  size="small"
                  label="Review"
                  sx={{ height: 20, bgcolor: `${REVIEW_COLOR}1f`, color: REVIEW_COLOR, fontWeight: 700 }}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {jobBlurb(job)}
            </Typography>
          </Box>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <StatusBadge status={job.status} />
          </Box>
          <ExpandMoreIcon
            sx={{
              color: 'text.secondary',
              transition: 'transform 0.2s',
              transform: isOpen ? 'rotate(180deg)' : 'none',
            }}
          />
        </Box>

        <Collapse in={isOpen} unmountOnExit>
          <Divider />
          <Box sx={{ px: 2, py: 1.5 }}>
            <Box sx={{ display: { xs: 'flex', sm: 'none' }, mb: 1.5 }}>
              <StatusBadge status={job.status} />
            </Box>

            {/* Inspection reports for this job */}
            <Typography variant="overline" color="text.secondary">
              Inspection reports
            </Typography>
            {jobReports.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
                None filed on this job yet.
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {jobReports.map((r) => (
                  <Stack
                    key={r.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <FactCheckOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {r.certificate_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Filed {fmtDay(r.submitted_at)}
                        {r.inspector_name ? ` · ${r.inspector_name}` : ''}
                      </Typography>
                    </Box>
                    {r.client_signed ? (
                      <Chip
                        size="small"
                        icon={<CheckCircleOutlineIcon />}
                        label="Signed"
                        sx={{ bgcolor: '#22c55e1f', color: '#22c55e', fontWeight: 700 }}
                      />
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        startIcon={<BorderColorOutlinedIcon />}
                        onClick={() => openSign(r)}
                      >
                        Sign now
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}

            {/* Review action */}
            {needsReview && review && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
                  <StarBorderIcon sx={{ fontSize: 20, color: REVIEW_COLOR }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                    How did we do on this job?
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<StarBorderIcon />}
                    onClick={() => setReviewTarget(review)}
                  >
                    Leave review
                  </Button>
                </Stack>
              </>
            )}

            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Received {fmtDay(job.date_received)}
                {job.due_date ? ` · Due ${fmtDay(job.due_date)}` : ''}
              </Typography>
              <Button size="small" startIcon={<WorkIcon />} onClick={() => navigate(`/jobs/${job.id}`)}>
                Open job
              </Button>
            </Stack>
          </Box>
        </Collapse>
      </Card>
    );
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Your workshop"
        title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
        subtitle={
          totalAction > 0
            ? `You have ${totalAction} thing${totalAction === 1 ? '' : 's'} waiting for you.`
            : 'Everything is up to date. Browse your jobs below.'
        }
      />

      <Grid container spacing={2} sx={{ mb: 1 }}>
        <Grid item xs={12} sm={6}>
          <NeedsCard
            color={SIGN_COLOR}
            icon={<BorderColorOutlinedIcon />}
            count={signCount}
            label={signCount === 1 ? 'report to sign' : 'reports to sign'}
            caption="Tap to review and sign"
            to="/inspection-reports"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <NeedsCard
            color={REVIEW_COLOR}
            icon={<StarBorderIcon />}
            count={reviewCount}
            label={reviewCount === 1 ? 'job to review' : 'jobs to review'}
            caption="Tap to rate your finished jobs"
            to="/reviews"
          />
        </Grid>
      </Grid>

      {jobs.length === 0 ? (
        <Card sx={{ p: 2, mt: 2 }}>
          <EmptyState
            icon={<FolderOutlinedIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title="No jobs yet"
            subtitle="When the workshop opens a job for you, it will appear here as a folder you can open."
          />
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Active jobs ({active.length})
              </Typography>
              <Stack spacing={1.25}>
                {active.map((j) => (
                  <JobFolder key={j.id} job={j} />
                ))}
              </Stack>
            </Box>
          )}

          {closed.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Closed jobs ({closed.length})
              </Typography>
              <Stack spacing={1.25}>
                {closed.map((j) => (
                  <JobFolder key={j.id} job={j} />
                ))}
              </Stack>
            </Box>
          )}
        </>
      )}

      {/* Sign dialog */}
      <Dialog open={!!signTarget} onClose={() => !saving && setSignTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Sign {signTarget?.certificate_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {signTarget?.job_number} · confirming you've reviewed and accept this inspection report.
          </Typography>
          <TextField
            label="Your name"
            fullWidth
            value={signName}
            onChange={(e) => setSignName(e.target.value)}
            sx={{ mb: 2 }}
            autoFocus
          />
          <Divider sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Signature
            </Typography>
          </Divider>
          <SignaturePad key={padKey} onChange={setSignature} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Draw your signature above, or leave it blank to sign with your typed name only.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submitSign} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit signature'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Review dialog */}
      {reviewTarget && (
        <ReviewDialog
          open
          jobId={reviewTarget.job_id}
          jobNumber={reviewTarget.job_number}
          customerName={reviewTarget.customer_name}
          onClose={() => setReviewTarget(null)}
          onSubmitted={load}
        />
      )}

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
