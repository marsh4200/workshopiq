import { createTheme, alpha } from '@mui/material/styles';

/**
 * WorkshopIQ design language.
 *
 * Grounded in the subject: a precision engineering workshop. The interface
 * should read like instrument software — disciplined, legible, trustworthy.
 * Signature device: job/serial numbers and key metrics set in a monospace
 * "spec sheet" face, because in a workshop the numbers ARE the identifiers.
 */

// Font stacks (loaded via index.html, with robust system fallbacks for offline use).
export const fontDisplay =
  "'Space Grotesk', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const fontBody =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const fontMono =
  "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

// Core palette — deep graphite base with a confident engineering blue.
export const palette = {
  bg: '#0a0e16',
  bgElevated: '#0e1422',
  surface: '#131b2c',
  surfaceRaised: '#18213440',
  line: 'rgba(148,163,184,0.12)',
  lineStrong: 'rgba(148,163,184,0.20)',
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  accent: '#f59e0b',
  textPrimary: '#e8edf6',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
};

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: palette.primary, dark: palette.primaryDark },
    secondary: { main: '#22d3ee' },
    success: { main: '#22c55e' },
    warning: { main: palette.accent },
    error: { main: '#f43f5e' },
    info: { main: '#38bdf8' },
    background: { default: palette.bg, paper: palette.surface },
    text: { primary: palette.textPrimary, secondary: palette.textSecondary },
    divider: palette.line,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: fontBody,
    h3: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.02em' },
    h4: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.02em' },
    h5: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600, letterSpacing: '0.01em' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    overline: {
      fontWeight: 600,
      letterSpacing: '0.14em',
      fontSize: 11,
      color: palette.textMuted,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*::selection': { background: alpha(palette.primary, 0.32) },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: palette.surface,
          border: `1px solid ${palette.line}`,
        },
        outlined: { borderColor: palette.line },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: palette.surface,
          backgroundImage: `linear-gradient(180deg, ${alpha('#1e2a47', 0.35)}, ${alpha('#0e1422', 0.0)})`,
          border: `1px solid ${palette.line}`,
          borderRadius: 16,
          transition: 'border-color .18s ease, transform .18s ease, box-shadow .18s ease',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          paddingInline: 18,
          transition: 'all .16s ease',
        },
        containedPrimary: {
          background: `linear-gradient(180deg, ${palette.primary}, ${palette.primaryDark})`,
          boxShadow: `0 1px 0 ${alpha('#fff', 0.12)} inset, 0 6px 18px ${alpha(palette.primaryDark, 0.35)}`,
          '&:hover': {
            background: `linear-gradient(180deg, #4c8df7, ${palette.primary})`,
            boxShadow: `0 1px 0 ${alpha('#fff', 0.16)} inset, 0 8px 22px ${alpha(palette.primaryDark, 0.5)}`,
          },
        },
        outlined: {
          borderColor: palette.lineStrong,
          '&:hover': { borderColor: alpha(palette.primary, 0.6), background: alpha(palette.primary, 0.06) },
        },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#0a0e16', 0.5),
          borderRadius: 10,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: palette.line },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.lineStrong },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: palette.primary,
            borderWidth: 1.5,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 8 },
        sizeSmall: { height: 23 },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1e293b',
          border: `1px solid ${palette.line}`,
          fontSize: 12,
          fontWeight: 500,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: palette.line },
        head: {
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: palette.textMuted,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: alpha('#0a0e16', 0.72),
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${palette.line}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16, border: `1px solid ${palette.line}` },
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
  },
});
