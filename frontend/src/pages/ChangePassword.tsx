import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import ShieldIcon from '@mui/icons-material/GppGoodOutlined';
import { useNavigate } from 'react-router-dom';
import { changePassword, apiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Logomark } from '../components/common';

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { label: 'Too short', color: '#64748b' },
    { label: 'Weak', color: '#f43f5e' },
    { label: 'Fair', color: '#f59e0b' },
    { label: 'Good', color: '#38bdf8' },
    { label: 'Strong', color: '#22c55e' },
    { label: 'Strong', color: '#22c55e' },
  ];
  return { score: s, ...map[s] };
}

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = user?.must_change_password;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const st = strength(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) return setError('New password must be at least 6 characters');
    if (next !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      await changePassword(current, next);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Could not change password'));
    } finally {
      setLoading(false);
    }
  };

  const pwField = (
    label: string,
    val: string,
    set: (v: string) => void,
    autoFocus = false,
  ) => (
    <Box>
      <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <TextField
        fullWidth
        autoFocus={autoFocus}
        type={show ? 'text' : 'password'}
        value={val}
        onChange={(e) => set(e.target.value)}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={() => setShow((s) => !s)} edge="end" size="small" tabIndex={-1}>
                {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 440, borderRadius: 4 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
          <Logomark size={42} />
          <Box>
            <Typography variant="h5">
              {forced ? 'Secure your account' : 'Change password'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {forced
                ? 'Set your own password to continue.'
                : 'Update your account password.'}
            </Typography>
          </Box>
        </Stack>

        {forced && (
          <Alert
            icon={<ShieldIcon fontSize="inherit" />}
            severity="info"
            variant="outlined"
            sx={{ mb: 2 }}
          >
            You signed in with a temporary password. Choose your own password to finish setting up your account.
          </Alert>
        )}

        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit}>
          <Stack spacing={2}>
            {pwField('Current password', current, setCurrent, true)}
            {pwField('New password', next, setNext)}
            {next.length > 0 && (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, (st.score / 5) * 100)}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: 'rgba(148,163,184,0.15)',
                    '& .MuiLinearProgress-bar': { bgcolor: st.color, borderRadius: 3 },
                  }}
                />
                <Typography variant="caption" sx={{ color: st.color, mt: 0.5, display: 'block' }}>
                  {st.label}
                </Typography>
              </Box>
            )}
            {pwField('Confirm new password', confirm, setConfirm)}
          </Stack>

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading}
            sx={{ mt: 3, py: 1.1 }}
          >
            {loading ? 'Saving…' : 'Update password'}
          </Button>
          {forced && (
            <Button fullWidth sx={{ mt: 1 }} color="inherit" onClick={logout}>
              Cancel and log out
            </Button>
          )}
        </form>
      </Paper>
    </Box>
  );
}
