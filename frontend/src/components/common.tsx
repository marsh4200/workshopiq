import { Avatar, Box, Chip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { fontDisplay, fontMono } from '../theme/theme';
import { useSettings } from '../context/SettingsContext';

export const STATUS_COLORS: Record<string, string> = {
  Received: '#94a3b8',
  Inspection: '#38bdf8',
  'Inspection Failed': '#f43f5e',
  Quotation: '#a855f7',
  'Awaiting Approval': '#f59e0b',
  'In Production': '#3b82f6',
  Machining: '#6366f1',
  Assembly: '#14b8a6',
  'Quality Control': '#eab308',
  Completed: '#22c55e',
  'Awaiting Customer Review': '#f59e0b',
  Collected: '#10b981',
  Closed: '#64748b',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#94a3b8';
  return (
    <Chip
      label={status}
      size="small"
      sx={{
        bgcolor: `${color}1f`,
        color,
        border: `1px solid ${color}3d`,
        fontWeight: 600,
        '& .MuiChip-label': { px: 1.1 },
      }}
    />
  );
}

const RESULT_COLORS: Record<string, string> = {
  pass: '#22c55e',
  fail: '#f43f5e',
  na: '#64748b',
};
export function ResultBadge({ result }: { result?: string | null }) {
  if (!result) return <Chip label="Pending" size="small" variant="outlined" />;
  const color = RESULT_COLORS[result] || '#64748b';
  const label = result === 'na' ? 'N/A' : result.charAt(0).toUpperCase() + result.slice(1);
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: `${color}1f`, color, border: `1px solid ${color}3d`, fontWeight: 700 }}
    />
  );
}

export const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtDay = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

/** Monospace serial/job number — the design signature. */
export function Serial({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Box
      component="span"
      sx={{ fontFamily: fontMono, fontWeight: 600, letterSpacing: '0.01em', ...sx }}
    >
      {children}
    </Box>
  );
}

/** The WorkshopIQ brand mark — uses the company logo when configured. */
export function Logomark({ size = 38 }: { size?: number }) {
  const { settings } = useSettings();
  if (settings?.company_logo) {
    return (
      <Avatar
        src={`/api/settings/logo/${settings.company_logo}`}
        variant="rounded"
        sx={{ width: size, height: size, borderRadius: size / 4 }}
      />
    );
  }
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: `${size / 4}px`,
        display: 'grid',
        placeItems: 'center',
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: size * 0.5,
        color: '#06121f',
        background: 'linear-gradient(150deg,#5b9bff,#2563eb)',
        boxShadow: '0 4px 14px rgba(37,99,235,0.4), inset 0 1px 0 rgba(255,255,255,0.35)',
      }}
    >
      W
    </Box>
  );
}

/** Consistent page heading with an eyebrow label and optional actions. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        mb: 3,
        display: 'flex',
        alignItems: { sm: 'flex-end' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 2,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <Typography variant="overline" sx={{ display: 'block', color: 'primary.main' }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ flexShrink: 0, display: 'flex', gap: 1 }}>{actions}</Box>}
    </Box>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
      {icon}
      <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 600 }}>
        {title}
      </Typography>
      {subtitle && <Typography variant="body2">{subtitle}</Typography>}
    </Box>
  );
}
