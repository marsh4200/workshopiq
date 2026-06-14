import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import { listJobs, fetchMeta, apiError } from '../api/client';
import { StatusBadge, fmtDay, EmptyState } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { JobListItem } from '../types';

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isClient } = useAuth();
  const isMobile = useDeviceType().isMobile;

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const statusFilter = params.get('status') || '';

  useEffect(() => {
    fetchMeta()
      .then((m) => setStatuses(m.statuses))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    listJobs(statusFilter || undefined)
      .then(setJobs)
      .catch((e) => setError(apiError(e, 'Failed to load jobs')))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.job_number.toLowerCase().includes(q) ||
        j.customer_name.toLowerCase().includes(q) ||
        (j.component_type || '').toLowerCase().includes(q),
    );
  }, [jobs, search]);

  const setStatus = (s: string) => {
    if (s) params.set('status', s);
    else params.delete('status');
    setParams(params, { replace: true });
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Typography variant="h4" fontWeight={800}>
          Jobs
        </Typography>
        {!isClient && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/jobs/new')}
          >
            New Job
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          placeholder="Search by job number, customer, component…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {statuses.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : filtered.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<WorkOutlineIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
            title="No jobs found"
            subtitle={statusFilter ? `No jobs with status "${statusFilter}".` : 'Create your first job to get started.'}
          />
        </Card>
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {filtered.map((j) => (
            <Card
              key={j.id}
              onClick={() => navigate(`/jobs/${j.id}`)}
              sx={{ p: 2, cursor: 'pointer' }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800}>{j.job_number}</Typography>
                <StatusBadge status={j.status} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {j.customer_name}
              </Typography>
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                {j.component_type ? (
                  <Chip label={j.component_type} size="small" variant="outlined" />
                ) : (
                  <span />
                )}
                <Typography variant="caption" color="text.secondary">
                  {fmtDay(j.date_received)}
                </Typography>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Job #</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Component</TableCell>
                <TableCell>Received</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((j) => (
                <TableRow
                  key={j.id}
                  hover
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
                  <TableCell>{j.customer_name}</TableCell>
                  <TableCell>
                    {j.component_type ? (
                      <Chip label={j.component_type} size="small" variant="outlined" />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{fmtDay(j.date_received)}</TableCell>
                  <TableCell>
                    <StatusBadge status={j.status} />
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
