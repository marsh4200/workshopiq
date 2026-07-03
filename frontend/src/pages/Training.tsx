import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import { TRAINING_TOPICS, type TrainingTopic } from '../data/trainingTopics';
import { useDeviceType } from '../hooks/useDeviceType';

export default function Training() {
  const isMobile = useDeviceType().isMobile;
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [open, setOpen] = useState<TrainingTopic | null>(null);
  const [step, setStep] = useState(0);

  const openTopic = (t: TrainingTopic) => {
    setOpen(t);
    setStep(0);
  };

  const close = () => setOpen(null);

  const steps = open?.steps ?? [];
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 2 }}>
        <SchoolOutlinedIcon color="action" />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Training
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 1.5,
        }}
      >
        {TRAINING_TOPICS.map((t) => (
          <Card
            key={t.id}
            variant="outlined"
            sx={{
              p: 2,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
              '&:hover': { borderColor: 'primary.main' },
            }}
            onClick={() => openTopic(t)}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Box sx={{ color: 'primary.main', display: 'flex' }}>{t.icon}</Box>
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{t.title}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t.subtitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t.steps.length} steps
            </Typography>
          </Card>
        ))}
      </Box>

      <Dialog open={!!open} onClose={close} fullWidth maxWidth="xs" fullScreen={fullScreen}>
        {open && current && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
              <Box sx={{ color: 'primary.main', display: 'flex' }}>{open.icon}</Box>
              {open.title}
              <IconButton onClick={close} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>
                {current.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {current.note}
              </Typography>
              {current.screen}

              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.5 }}>
                <Button
                  size="small"
                  startIcon={<ArrowBackIcon fontSize="small" />}
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  Back
                </Button>
                <Stack direction="row" spacing={0.75}>
                  {steps.map((_, i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: i === step ? 'primary.main' : 'action.disabledBackground',
                      }}
                    />
                  ))}
                </Stack>
                {isLast ? (
                  <Button size="small" onClick={close}>
                    Done
                  </Button>
                ) : (
                  <Button
                    size="small"
                    endIcon={<ArrowForwardIcon fontSize="small" />}
                    onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                  >
                    Next
                  </Button>
                )}
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
