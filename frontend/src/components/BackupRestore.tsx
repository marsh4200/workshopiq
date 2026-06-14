import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import { downloadBackup, restoreBackup, apiError } from '../api/client';

export default function BackupRestore() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    setMsg('');
    try {
      await downloadBackup();
      setMsg('Backup downloaded. Keep it somewhere safe.');
    } catch (e) {
      setError(apiError(e, 'Backup failed'));
    } finally {
      setDownloading(false);
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPendingFile(f);
      setConfirmText('');
    }
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    setError('');
    setMsg('');
    try {
      const res = await restoreBackup(pendingFile);
      const total = Object.values(res.counts || {}).reduce((a, b) => a + b, 0);
      setMsg(
        `Restore complete — ${total} records restored from a ${res.restored_from_version || '?'} backup. ` +
          'Reloading…',
      );
      setPendingFile(null);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setError(apiError(e, 'Restore failed'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Box>
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Button
          variant="contained"
          startIcon={downloading ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
          onClick={handleDownload}
          disabled={downloading || restoring}
        >
          {downloading ? 'Preparing backup…' : 'Download Backup'}
        </Button>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<RestoreIcon />}
          onClick={() => fileInput.current?.click()}
          disabled={downloading || restoring}
        >
          Restore from Backup
        </Button>
        <input
          type="file"
          accept=".zip"
          hidden
          ref={fileInput}
          onChange={pickFile}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        A backup captures everything — all jobs, users, settings, reviews and every
        uploaded photo and document — in a single file. To recover after a crash,
        reinstall WorkshopIQ, then restore that file here.
      </Typography>

      {/* Restore confirmation (destructive) */}
      <Dialog
        open={!!pendingFile}
        onClose={() => !restoring && setPendingFile(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Restore from backup?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will <strong>permanently overwrite all current data and uploads</strong> with
            the contents of the backup. This cannot be undone.
          </Alert>
          <DialogContentText sx={{ mb: 2 }}>
            File: <strong>{pendingFile?.name}</strong>
            <br />
            Type <strong>RESTORE</strong> below to confirm.
          </DialogContentText>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            placeholder="RESTORE"
            disabled={restoring}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 16,
              letterSpacing: '0.15em',
              borderRadius: 8,
              border: '1px solid rgba(148,163,184,0.4)',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPendingFile(null)} disabled={restoring}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleRestore}
            disabled={restoring || confirmText !== 'RESTORE'}
            startIcon={restoring ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {restoring ? 'Restoring…' : 'Restore now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
