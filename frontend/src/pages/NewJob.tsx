import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Grid,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { createJob, fetchMeta, listClients, apiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';

export default function NewJob() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [clients, setClients] = useState<User[]>([]);
  const [clientIds, setClientIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customer_name: '',
    contact_person: '',
    phone: '',
    email: '',
    po_number: '',
    component_type: '',
    date_received: new Date().toISOString().slice(0, 10),
    description: '',
  });

  useEffect(() => {
    fetchMeta()
      .then((m) => setComponentTypes(m.component_types))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    listClients()
      .then(setClients)
      .catch(() => undefined);
  }, [isAdmin]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const clientLabel = (c: User) => c.full_name || c.username;
  const handleClientChange = (e: SelectChangeEvent<number[]>) => {
    const value = e.target.value;
    setClientIds(typeof value === 'string' ? [] : (value as number[]));
  };

  const submit = async () => {
    if (!form.customer_name.trim()) {
      setError('Customer name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        ...form,
        date_received: form.date_received
          ? new Date(form.date_received).toISOString()
          : undefined,
      };
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      if (isAdmin) payload.client_user_ids = clientIds;
      const job = await createJob(payload);
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setError(apiError(e, 'Failed to create job'));
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/jobs')} sx={{ mb: 2 }}>
        Back to Jobs
      </Button>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        New Job Intake
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A job number is generated automatically based on the configured prefix.
      </Typography>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Customer Name"
              required
              fullWidth
              value={form.customer_name}
              onChange={(e) => set('customer_name', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Contact Person"
              fullWidth
              value={form.contact_person}
              onChange={(e) => set('contact_person', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Phone"
              fullWidth
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Email"
              type="email"
              fullWidth
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="PO Number"
              fullWidth
              value={form.po_number}
              onChange={(e) => set('po_number', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              label="Component Type"
              fullWidth
              value={form.component_type}
              onChange={(e) => set('component_type', e.target.value)}
            >
              <MenuItem value="">— Not specified —</MenuItem>
              {componentTypes.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Date Received"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.date_received}
              onChange={(e) => set('date_received', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Description / Scope of Work"
              fullWidth
              multiline
              minRows={4}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Grid>
          {isAdmin && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Client Access
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Optionally grant client users access to this job now. You can also
                change this later from the Client Access tab.
              </Typography>
              {clients.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No client users exist yet. Create them on the Users page first.
                </Typography>
              ) : (
                <Select
                  multiple
                  fullWidth
                  displayEmpty
                  value={clientIds}
                  onChange={handleClientChange}
                  input={<OutlinedInput />}
                  renderValue={(selected) =>
                    (selected as number[]).length === 0 ? (
                      <Typography component="span" color="text.secondary">
                        — Select client(s) —
                      </Typography>
                    ) : (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {(selected as number[]).map((id) => {
                          const c = clients.find((x) => x.id === id);
                          return <Chip key={id} size="small" label={c ? clientLabel(c) : id} />;
                        })}
                      </Box>
                    )
                  }
                >
                  {clients.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      <Checkbox checked={clientIds.includes(c.id)} />
                      <ListItemText
                        primary={clientLabel(c)}
                        secondary={c.full_name ? c.username : undefined}
                      />
                    </MenuItem>
                  ))}
                </Select>
              )}
            </Grid>
          )}
        </Grid>

        {error && (
          <Typography color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}

        <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ mt: 3 }}>
          <Button onClick={() => navigate('/jobs')}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Job'}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
