import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import SummarizeIcon from '@mui/icons-material/SummarizeOutlined';
import { getJobReport, fetchMeta, apiError } from '../api/client';
import { StatusBadge, fmtDay, EmptyState } from '../components/common';
import { useSettings } from '../context/SettingsContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { JobReportResponse } from '../types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const now = new Date();
const YEARS = Array.from({ length: 7 }, (_, i) => now.getFullYear() - i);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

export default function Reports() {
  const { settings } = useSettings();
  const isMobile = useDeviceType().isMobile;

  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);

  const [report, setReport] = useState<JobReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMeta()
      .then((m) => setStatuses(m.statuses))
      .catch(() => undefined);
  }, []);

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getJobReport({
        period,
        year,
        month: period === 'month' ? month : undefined,
        status: status || undefined,
      });
      setReport(data);
    } catch (e) {
      setError(apiError(e, 'Failed to generate report'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const logoUrl = settings?.company_logo
    ? `/api/settings/logo/${settings.company_logo}`
    : '';

  const handlePrint = () => {
    if (!report) return;
    const company = report.company_name || 'WorkshopIQ';
    const title = `${period === 'month' ? 'Monthly' : 'Yearly'} Job Report`;
    const generated = new Date(report.generated_at).toLocaleString();

    const rows = report.jobs
      .map(
        (j, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="mono">${escapeHtml(j.job_number)}</td>
          <td>${escapeHtml(j.customer_name)}</td>
          <td>${escapeHtml(j.po_number || '—')}</td>
          <td>${escapeHtml(j.component_type || '—')}</td>
          <td>${escapeHtml(j.status)}</td>
          <td>${new Date(j.date_received).toLocaleDateString()}</td>
        </tr>`,
      )
      .join('');

    const breakdown = Object.entries(report.status_breakdown)
      .filter(([, c]) => c > 0)
      .map(([s, c]) => `<span class="pill">${escapeHtml(s)}: <b>${c}</b></span>`)
      .join('');

    const filterLine = report.status_filter
      ? `<div class="meta">Filtered by status: <b>${escapeHtml(report.status_filter)}</b></div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(company)} — ${title} — ${escapeHtml(report.period_label)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #111; margin: 32px; font-size: 12px;
  }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 14px; }
  header img { height: 52px; width: auto; object-fit: contain; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .brand .sub { color: #555; font-size: 12px; margin-top: 2px; }
  .report-title { text-align: right; margin-left: auto; }
  .report-title .t { font-size: 15px; font-weight: 700; }
  .report-title .p { font-size: 18px; font-weight: 800; }
  .meta { color: #555; margin-top: 4px; font-size: 11px; }
  .summary { margin: 16px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .total { font-size: 14px; font-weight: 700; margin-right: 8px; }
  .pill { border: 1px solid #ccc; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num { color: #888; width: 28px; }
  td.mono { font-family: 'SF Mono', Consolas, monospace; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; display: flex; justify-content: space-between; }
  .empty { padding: 40px; text-align: center; color: #777; }
  @media print {
    body { margin: 14mm; }
    @page { size: A4; margin: 12mm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" onerror="this.style.display='none'" />` : ''}
    <div class="brand">
      <h1>${escapeHtml(company)}</h1>
      <div class="sub">Workshop Job Report</div>
    </div>
    <div class="report-title">
      <div class="t">${title}</div>
      <div class="p">${escapeHtml(report.period_label)}</div>
      ${filterLine}
    </div>
  </header>

  <div class="summary">
    <span class="total">${report.total} job${report.total === 1 ? '' : 's'}</span>
    ${breakdown}
  </div>

  ${
    report.jobs.length
      ? `<table>
    <thead>
      <tr>
        <th>#</th><th>Job #</th><th>Client</th><th>PO Number</th>
        <th>Component</th><th>Status</th><th>Received</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
      : `<div class="empty">No jobs recorded for this period.</div>`
  }

  <footer>
    <span>Generated ${escapeHtml(generated)}</span>
    <span>${escapeHtml(company)} · WorkshopIQ</span>
  </footer>
  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      setError('Could not open print window — please allow pop-ups for this site.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const activeBreakdown = useMemo(
    () =>
      report
        ? Object.entries(report.status_breakdown).filter(([, c]) => c > 0)
        : [],
    [report],
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
          Reports
        </Typography>
      </Stack>

      {/* Controls */}
      <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}>
        <Stack spacing={2}>
          <ToggleButtonGroup
            color="primary"
            exclusive
            value={period}
            onChange={(_e, v) => v && setPeriod(v)}
            size="small"
          >
            <ToggleButton value="month" sx={{ px: 3 }}>
              Monthly
            </ToggleButton>
            <ToggleButton value="year" sx={{ px: 3 }}>
              Yearly
            </ToggleButton>
          </ToggleButtonGroup>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {period === 'month' && (
              <TextField
                select
                label="Month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                sx={{ minWidth: 180 }}
              >
                {MONTHS.map((m, i) => (
                  <MenuItem key={m} value={i + 1}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={{ minWidth: 140 }}
            >
              {YEARS.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status (optional)"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={generate}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SummarizeIcon />}
              sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            >
              Generate
            </Button>
          </Stack>
        </Stack>
      </Card>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {/* Results */}
      {report && (
        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                {period === 'month' ? 'Monthly' : 'Yearly'} Report · {report.period_label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {report.total} job{report.total === 1 ? '' : 's'}
                {report.status_filter ? ` · ${report.status_filter}` : ''}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              disabled={!report.total}
            >
              Print / Save PDF
            </Button>
          </Stack>

          {activeBreakdown.length > 0 && (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                {activeBreakdown.map(([s, c]) => (
                  <Chip key={s} label={`${s}: ${c}`} size="small" variant="outlined" />
                ))}
              </Stack>
              <Divider sx={{ mb: 2 }} />
            </>
          )}

          {report.jobs.length === 0 ? (
            <EmptyState
              icon={<SummarizeIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
              title="No jobs for this period"
              subtitle="Try a different month or year."
            />
          ) : isMobile ? (
            <Stack spacing={1.5}>
              {report.jobs.map((j) => (
                <Card key={j.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={800}>{j.job_number}</Typography>
                    <StatusBadge status={j.status} />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {j.customer_name}
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      PO: {j.po_number || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fmtDay(j.date_received)}
                    </Typography>
                  </Stack>
                </Card>
              ))}
            </Stack>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job #</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>PO Number</TableCell>
                  <TableCell>Component</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.jobs.map((j) => (
                  <TableRow key={j.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
                    <TableCell>{j.customer_name}</TableCell>
                    <TableCell>{j.po_number || '—'}</TableCell>
                    <TableCell>{j.component_type || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={j.status} />
                    </TableCell>
                    <TableCell>{fmtDay(j.date_received)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </Box>
  );
}
