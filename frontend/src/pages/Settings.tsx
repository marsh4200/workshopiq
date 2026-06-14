import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UploadIcon from '@mui/icons-material/Upload';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import {
  getSettings,
  updateSettings,
  uploadLogo,
  checkUpdates,
  applyUpdate,
  getUpdateStatus,
  apiError,
} from '../api/client';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import UpdateProgressDialog from '../components/UpdateProgressDialog';
import BackupRestore from '../components/BackupRestore';
import type { AppSettings } from '../types';

const NO_RIGHTS_MSG =
  'Unfortunately, you do not have these rights. Please contact the Everton administrating team.';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        <Box sx={{ mt: 2 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { reload } = useSettings();
  const { isAdmin } = useAuth();
  const [s, setS] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [updateNote, setUpdateNote] = useState<
    { severity: 'success' | 'info' | 'error'; text: string } | null
  >(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const load = () =>
    getSettings()
      .then(setS)
      .catch((e) => setError(apiError(e, 'Failed to load settings')));

  useEffect(() => {
    load();
  }, []);

  const set = (k: keyof AppSettings, v: string) =>
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setError('');
    setMsg('');
    try {
      const body: Record<string, unknown> = {
        company_name: s.company_name,
        dashboard_branding: s.dashboard_branding,
        job_number_prefix: s.job_number_prefix,
        email_host: s.email_host,
        email_port: s.email_port,
        email_user: s.email_user,
        email_from: s.email_from,
        github_repo_url: s.github_repo_url,
      };
      const updated = await updateSettings(body);
      setS(updated);
      setMsg('Settings saved.');
      reload();
    } catch (e) {
      setError(apiError(e, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const onLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await uploadLogo(file);
      setS(updated);
      setMsg('Logo uploaded.');
      reload();
    } catch (err) {
      setError(apiError(err, 'Failed to upload logo'));
    }
  };

  const doCheck = async () => {
    setChecking(true);
    setError('');
    setMsg('');
    setUpdateNote(null);
    // Non-administrators may view the panel but cannot run update checks.
    // Show the spinner briefly, then deny with a clear message.
    if (!isAdmin) {
      window.setTimeout(() => {
        setChecking(false);
        setUpdateNote({ severity: 'error', text: NO_RIGHTS_MSG });
      }, 1100);
      return;
    }
    try {
      const updated = await checkUpdates();
      setS(updated);
      if (updated.available_version && updated.available_version !== updated.current_version) {
        setUpdateNote({
          severity: 'info',
          text: `Update available: v${updated.available_version}`,
        });
      } else {
        setUpdateNote({
          severity: 'success',
          text: `You're on the latest version (v${updated.current_version}).`,
        });
      }
    } catch (e) {
      setUpdateNote({
        severity: 'error',
        text: apiError(e, 'Update check failed. Please try again shortly.'),
      });
    } finally {
      setChecking(false);
    }
  };

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateState, setUpdateState] = useState<'queued' | 'running' | 'done' | 'error' | 'idle'>('idle');
  const [updateLog, setUpdateLog] = useState('');
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const doApply = async () => {
    if (!isAdmin) {
      setError(NO_RIGHTS_MSG);
      return;
    }
    if (!window.confirm('Apply update? The database will be backed up and the server will restart.'))
      return;
    setApplying(true);
    setError('');
    setMsg('');
    setUpdateNote(null);
    setUpdateLog('');
    setUpdateState('queued');
    setUpdateOpen(true);
    try {
      await applyUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to request update'));
      setUpdateOpen(false);
      setApplying(false);
      return;
    }

    // Poll for progress. The backend (and frontend) restart mid-update, so
    // failed polls are expected briefly — keep trying until done/error.
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await getUpdateStatus();
        setUpdateLog(st.log || '');
        setUpdateState((st.status as typeof updateState) || 'running');
        if (st.status === 'done' || st.status === 'error') {
          stopPolling();
          setApplying(false);
          if (st.status === 'done') refreshSettings();
        }
      } catch {
        // Backend is likely restarting — show that and keep polling.
        setUpdateState((prev) => (prev === 'done' || prev === 'error' ? prev : 'running'));
      }
    }, 2000);
  };

  const refreshSettings = () => {
    getSettings().then(setS).catch(() => undefined);
  };

  if (!s)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const updateAvailable =
    !!s.available_version && s.available_version !== s.current_version && s.available_version !== '';

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 3 }}>
        Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {msg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>
          {msg}
        </Alert>
      )}

      {isAdmin && (
        <>
      <Section title="Company & Branding" subtitle="Shown across the portal and on the dashboard.">
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Company Name"
              fullWidth
              value={s.company_name}
              onChange={(e) => set('company_name', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Dashboard Tagline"
              fullWidth
              value={s.dashboard_branding || ''}
              onChange={(e) => set('dashboard_branding', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => logoInput.current?.click()}
              >
                Upload Logo
              </Button>
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={onLogo}
              />
              {s.company_logo ? (
                <Typography variant="body2" color="text.secondary">
                  Current: {s.company_logo}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No logo uploaded.
                </Typography>
              )}
            </Stack>
          </Grid>
        </Grid>
      </Section>

      <Section
        title="Job Numbering"
        subtitle='Prefix for new job numbers. Changing it does not reset the running sequence — e.g. "Job 12" → change prefix → "Everton 13".'
      >
        <TextField
          label="Job Number Prefix"
          value={s.job_number_prefix}
          onChange={(e) => set('job_number_prefix', e.target.value)}
          sx={{ maxWidth: 320 }}
        />
      </Section>

      <Section title="Email (SMTP)" subtitle="Optional. Used for outbound notifications.">
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Host"
              fullWidth
              value={s.email_host || ''}
              onChange={(e) => set('email_host', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Port"
              fullWidth
              value={s.email_port || ''}
              onChange={(e) => set('email_port', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Username"
              fullWidth
              value={s.email_user || ''}
              onChange={(e) => set('email_user', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="From Address"
              fullWidth
              value={s.email_from || ''}
              onChange={(e) => set('email_from', e.target.value)}
            />
          </Grid>
        </Grid>
      </Section>

      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 4 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </Stack>
        </>
      )}

      <Card
        sx={{
          mb: 3,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: updateAvailable ? 'success.main' : 'divider',
        }}
      >
        {/* Header band */}
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            background: (t) =>
              `linear-gradient(135deg, ${t.palette.primary.dark} 0%, ${t.palette.primary.main} 100%)`,
            color: 'primary.contrastText',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.18)',
            }}
          >
            <SystemUpdateAltIcon />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
              Software Updates
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Secure in-app updates · automatic backup &amp; restart
            </Typography>
          </Box>
          <Chip
            size="small"
            label={updateAvailable ? 'Update available' : 'Up to date'}
            sx={{
              fontWeight: 700,
              color: updateAvailable ? '#0b2e13' : '#0b2e13',
              bgcolor: updateAvailable ? 'success.light' : 'rgba(255,255,255,0.92)',
            }}
            icon={updateAvailable ? <SystemUpdateAltIcon /> : <CheckCircleIcon />}
          />
        </Box>

        <CardContent sx={{ p: 3 }}>
          {/* Version stat tiles */}
          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            <Grid item xs={6}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                  Installed
                </Typography>
                <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                  v{s.current_version}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: updateAvailable ? 'success.main' : 'divider',
                  bgcolor: updateAvailable ? 'success.dark' : 'action.hover',
                  color: updateAvailable ? 'success.contrastText' : 'inherit',
                }}
              >
                <Typography
                  variant="overline"
                  letterSpacing={1}
                  sx={{ color: updateAvailable ? 'inherit' : 'text.secondary', opacity: 0.9 }}
                >
                  Latest
                </Typography>
                <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                  {s.available_version ? `v${s.available_version}` : '—'}
                </Typography>
              </Box>
            </Grid>
          </Grid>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              fullWidth
              variant="outlined"
              size="large"
              startIcon={checking ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={doCheck}
              disabled={checking}
              sx={{ fontWeight: 700 }}
            >
              {checking ? 'Checking…' : 'Check for Updates'}
            </Button>
            <Button
              fullWidth
              variant="contained"
              color="success"
              size="large"
              disableElevation
              startIcon={<SystemUpdateAltIcon />}
              onClick={doApply}
              disabled={!updateAvailable || applying}
              sx={{ fontWeight: 800 }}
            >
              {applying ? 'Applying…' : updateAvailable ? `Install v${s.available_version}` : 'Apply Update'}
            </Button>
          </Stack>

          {updateNote && (
            <Alert
              severity={updateNote.severity}
              variant="outlined"
              onClose={() => setUpdateNote(null)}
              sx={{ mt: 2 }}
            >
              {updateNote.text}
            </Alert>
          )}

          <Box
            sx={{
              mt: 2.5,
              pt: 2,
              borderTop: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">
              Proprietary software · built and maintained on custom code. Updates are backed up
              and applied automatically with zero downtime.
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {isAdmin && (
        <Section
          title="Backup & Restore"
          subtitle="Download a complete copy of the system, or restore everything from a backup file."
        >
          <BackupRestore />
        </Section>
      )}

      <UpdateProgressDialog
        open={updateOpen}
        state={updateState}
        log={updateLog}
        onClose={() => setUpdateOpen(false)}
        onReload={() => window.location.reload()}
      />
    </Box>
  );
}
