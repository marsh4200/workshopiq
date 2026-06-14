import { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/MoveToInbox';
import BuildIcon from '@mui/icons-material/Construction';
import CheckCircleIcon from '@mui/icons-material/TaskAlt';
import ArchiveIcon from '@mui/icons-material/Inventory2';
import HistoryIcon from '@mui/icons-material/History';
import TrendingFlatIcon from '@mui/icons-material/ArrowOutward';
import { BarChart } from '@mui/x-charts/BarChart';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../api/client';
import { STATUS_COLORS, fmtDate, PageHeader } from '../components/common';
import { fontMono } from '../theme/theme';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import type { DashboardStats } from '../types';

const STAT_DEFS = [
  { key: 'received', label: 'Received', icon: <InboxIcon />, color: '#94a3b8', filter: 'Received' },
  { key: 'machining', label: 'Machining', icon: <BuildIcon />, color: '#6366f1', filter: 'Machining' },
  { key: 'completed', label: 'Completed', icon: <CheckCircleIcon />, color: '#22c55e', filter: 'Completed' },
  { key: 'closed', label: 'Closed', icon: <ArchiveIcon />, color: '#64748b', filter: 'Closed' },
] as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { settings } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    getDashboard()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );

  const breakdown = stats?.status_breakdown || {};
  const chartData = Object.entries(breakdown).filter(([, v]) => v > 0);
  const firstName = (user?.full_name || user?.username || '').split(' ')[0];

  return (
    <Box>
      <PageHeader
        eyebrow={settings?.dashboard_branding || 'Operations overview'}
        title={
          user?.role === 'client'
            ? 'Your jobs'
            : `${greeting()}${firstName ? `, ${firstName}` : ''}`
        }
        subtitle={
          user?.role === 'client'
            ? 'Track progress and recent updates on your jobs.'
            : `${stats?.total ?? 0} jobs on the floor · ${settings?.company_name || 'WorkshopIQ'}`
        }
      />

      <Grid container spacing={2.5}>
        {STAT_DEFS.map((d) => {
          const value = stats ? (stats as any)[d.key] : 0;
          return (
            <Grid item xs={6} lg={3} key={d.key}>
              <Card sx={{ '&:hover': { borderColor: `${d.color}66`, transform: 'translateY(-2px)' } }}>
                <CardActionArea onClick={() => navigate(`/jobs?status=${encodeURIComponent(d.filter)}`)}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 2.5,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: `${d.color}1f`,
                        color: d.color,
                        border: `1px solid ${d.color}3d`,
                        flexShrink: 0,
                      }}
                    >
                      {d.icon}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontFamily: fontMono, fontWeight: 700, fontSize: 30, lineHeight: 1 }}>
                        {value}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {d.label}
                      </Typography>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Status overview
              </Typography>
              <Divider sx={{ mb: 1 }} />
              {chartData.length ? (
                <BarChart
                  height={300}
                  borderRadius={6}
                  margin={{ left: 40, right: 10, top: 20, bottom: 72 }}
                  xAxis={[
                    {
                      scaleType: 'band',
                      data: chartData.map(([k]) => k),
                      tickLabelStyle: { angle: -35, textAnchor: 'end', fontSize: 11 },
                    },
                  ]}
                  series={[{ data: chartData.map(([, v]) => v), label: 'Jobs', color: '#3b82f6' }]}
                  slotProps={{ legend: { hidden: true } }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                  No jobs yet. Create one to see status analytics.
                </Typography>
              )}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {Object.entries(breakdown).map(([status, count]) => (
                  <Chip
                    key={status}
                    onClick={() => navigate(`/jobs?status=${encodeURIComponent(status)}`)}
                    label={`${status} · ${count}`}
                    size="small"
                    sx={{
                      cursor: 'pointer',
                      bgcolor: `${STATUS_COLORS[status]}1a`,
                      color: STATUS_COLORS[status],
                      border: `1px solid ${STATUS_COLORS[status]}44`,
                    }}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <HistoryIcon fontSize="small" color="primary" />
                <Typography variant="h6">Recent activity</Typography>
              </Box>
              <Divider sx={{ mb: 0.5 }} />
              {stats?.recent_activity.length ? (
                <Box>
                  {stats.recent_activity.map((e) => (
                    <Box
                      key={e.id}
                      sx={{
                        display: 'flex',
                        gap: 1.5,
                        py: 1.25,
                        borderBottom: '1px solid rgba(148,163,184,0.08)',
                        '&:last-of-type': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ width: 7, height: 7, borderRadius: 4, bgcolor: 'primary.main', mt: 0.9, flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {e.description}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {e.actor_name ? `${e.actor_name} · ` : ''}
                          {fmtDate(e.created_at)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                  <TrendingFlatIcon sx={{ opacity: 0.4 }} />
                  <Typography variant="body2">No activity recorded yet.</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
