import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Collapse,
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
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import { listJobs, fetchMeta, apiError } from '../api/client';
import { StatusBadge, fmtDay, dueInfo, EmptyState } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { JobListItem } from '../types';

interface CustomerGroup {
  key: string;
  name: string;
  jobs: JobListItem[];
}

// Newest first: by received date, then job number as a stable fallback.
function byRecency(a: JobListItem, b: JobListItem): number {
  const da = a.date_received ? Date.parse(a.date_received) : 0;
  const db = b.date_received ? Date.parse(b.date_received) : 0;
  if (da !== db) return db - da;
  return b.job_number.localeCompare(a.job_number, undefined, { numeric: true });
}

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
  // Which customer folders are open. Keyed by the normalised customer name.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const statusFilter = params.get('status') || '';
  // Optional due-date lens, set by the dashboard tiles: 'overdue' | 'soon'.
  const dueFilter = params.get('due') || '';

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
    let list = jobs;
    // Due lens first (driven by the dashboard tiles).
    if (dueFilter === 'overdue' || dueFilter === 'soon') {
      list = list.filter((j) => {
        const done = j.status === 'Completed' || j.status === 'Closed';
        if (done || !j.due_date) return false;
        const { days } = dueInfo(j.due_date, done);
        return dueFilter === 'overdue' ? days < 0 : days >= 0 && days <= 7;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (j) =>
        j.job_number.toLowerCase().includes(q) ||
        j.customer_name.toLowerCase().includes(q) ||
        (j.component_type || '').toLowerCase().includes(q) ||
        (j.po_number || '').toLowerCase().includes(q) ||
        (j.eq_number || '').toLowerCase().includes(q),
    );
  }, [jobs, search, dueFilter]);

  // Group jobs into one folder per customer, alphabetical by name.
  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const j of filtered) {
      const name = (j.customer_name || 'Unassigned').trim() || 'Unassigned';
      const key = name.toLowerCase();
      const g = map.get(key);
      if (g) g.jobs.push(j);
      else map.set(key, { key, name, jobs: [j] });
    }
    const list = Array.from(map.values());
    list.forEach((g) => g.jobs.sort(byRecency));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [filtered]);

  const searching = search.trim().length > 0;
  // While searching, every matching folder is forced open so results show.
  // Otherwise a single customer opens by default; the rest start collapsed.
  const isOpen = (key: string) =>
    searching ? true : open[key] ?? groups.length === 1;

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? groups.length === 1) }));

  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(groups.map((g) => [g.key, value])));

  const setStatus = (s: string) => {
    if (s) params.set('status', s);
    else params.delete('status');
    setParams(params, { replace: true });
  };

  const clearDue = () => {
    params.delete('due');
    setParams(params, { replace: true });
  };

  const JobRows = ({ group }: { group: CustomerGroup }) =>
    isMobile ? (
      <Stack spacing={1.25} sx={{ p: 1.5, pt: 0.5 }}>
        {group.jobs.map((j) => (
          <Card
            key={j.id}
            variant="outlined"
            onClick={() => navigate(`/jobs/${j.id}`)}
            sx={{ p: 1.5, cursor: 'pointer', bgcolor: 'background.default' }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontWeight={800}>{j.job_number}</Typography>
              <StatusBadge status={j.status} />
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
              {j.component_type ? (
                <Chip label={j.component_type} size="small" variant="outlined" />
              ) : (
                <span />
              )}
              <Stack direction="row" spacing={1} alignItems="center">
                {(() => {
                  const d = dueInfo(j.due_date, j.status === 'Completed' || j.status === 'Closed');
                  if (d.chip) return <Chip size="small" color={d.color} label={d.chip} />;
                  if (j.due_date)
                    return (
                      <Typography variant="caption" color="text.secondary">
                        Due {d.label}
                      </Typography>
                    );
                  return null;
                })()}
                <Typography variant="caption" color="text.secondary">
                  {fmtDay(j.date_received)}
                </Typography>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <Table size="small" sx={{ '& td, & th': { borderColor: 'divider' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Job #</TableCell>
            <TableCell>Component</TableCell>
            <TableCell>Received</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {group.jobs.map((j) => (
            <TableRow
              key={j.id}
              hover
              onClick={() => navigate(`/jobs/${j.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
              <TableCell>
                {j.component_type ? (
                  <Chip label={j.component_type} size="small" variant="outlined" />
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>{fmtDay(j.date_received)}</TableCell>
              <TableCell>
                {(() => {
                  const d = dueInfo(j.due_date, j.status === 'Completed' || j.status === 'Closed');
                  if (d.chip) return <Chip size="small" color={d.color} label={d.chip} />;
                  if (j.due_date) return d.label;
                  return '—';
                })()}
              </TableCell>
              <TableCell>
                <StatusBadge status={j.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

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
          placeholder="Search by job number, customer, component, PO or EQ…"
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

      {dueFilter && (
        <Stack direction="row" sx={{ mb: 2 }}>
          <Chip
            color={dueFilter === 'overdue' ? 'error' : 'warning'}
            variant="outlined"
            label={
              dueFilter === 'overdue'
                ? 'Showing overdue jobs'
                : 'Showing jobs due within 7 days'
            }
            onDelete={clearDue}
          />
        </Stack>
      )}

      {!loading && !error && groups.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, alignSelf: 'center' }}>
            {groups.length} customer{groups.length === 1 ? '' : 's'} · {filtered.length} job
            {filtered.length === 1 ? '' : 's'}
          </Typography>
          <Button size="small" startIcon={<UnfoldMoreIcon />} onClick={() => setAll(true)} disabled={searching}>
            Expand all
          </Button>
          <Button size="small" startIcon={<UnfoldLessIcon />} onClick={() => setAll(false)} disabled={searching}>
            Collapse all
          </Button>
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : groups.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<WorkOutlineIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
            title="No jobs found"
            subtitle={
              dueFilter === 'overdue'
                ? 'No overdue jobs — nicely on top of it.'
                : dueFilter === 'soon'
                ? 'Nothing due in the next 7 days.'
                : statusFilter
                ? `No jobs with status "${statusFilter}".`
                : 'Create your first job to get started.'
            }
          />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {groups.map((g) => {
            const expanded = isOpen(g.key);
            return (
              <Card key={g.key} sx={{ overflow: 'hidden' }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  onClick={() => !searching && toggle(g.key)}
                  sx={{
                    px: 2,
                    py: 1.5,
                    cursor: searching ? 'default' : 'pointer',
                    userSelect: 'none',
                    '&:hover': searching ? {} : { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ color: 'primary.main', display: 'flex' }}>
                    {expanded ? <FolderOpenOutlinedIcon /> : <FolderOutlinedIcon />}
                  </Box>
                  <Typography fontWeight={800} sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    {g.name}
                  </Typography>
                  <Chip label={g.jobs.length} size="small" sx={{ fontWeight: 700 }} />
                  <ExpandMoreIcon
                    sx={{
                      transition: 'transform 0.2s',
                      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      color: 'text.secondary',
                    }}
                  />
                </Stack>
                <Collapse in={expanded} unmountOnExit>
                  <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
                    <JobRows group={g} />
                  </Box>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
