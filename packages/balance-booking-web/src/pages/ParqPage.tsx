import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gqlClient } from '../lib/api';
import { SUBMIT_PARQ } from '../lib/queries';

export function ParqPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hasMedical, setHasMedical] = useState(false);
  const [medicalDetails, setMedicalDetails] = useState('');
  const [pregnant, setPregnant] = useState(false);
  const [injuries, setInjuries] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      return gqlClient().request(SUBMIT_PARQ, {
        input: {
          hasMedicalConditions: hasMedical,
          medicalDetails: hasMedical ? medicalDetails : null,
          pregnant,
          injuries: injuries || null,
          emergencyContactName: emergencyName,
          emergencyContactPhone: emergencyPhone,
          acknowledgedAt: new Date().toISOString(),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      navigate('/basket');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <section className="max-w-xl">
      <h1 className="text-4xl mt-0">Health questionnaire (PAR-Q)</h1>
      <p className="text-text-muted">
        We ask everyone these once before their first class. You won't have to do this again.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-6">
        <Field label="Do you have any medical conditions we should know about?">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hasMedical}
              onChange={(e) => setHasMedical(e.target.checked)}
              className="w-5 h-5"
            />
            Yes
          </label>
          {hasMedical && (
            <textarea
              required
              value={medicalDetails}
              onChange={(e) => setMedicalDetails(e.target.value)}
              className="mt-3 w-full p-3 border border-stone rounded-md bg-white"
              rows={3}
              placeholder="Please describe…"
            />
          )}
        </Field>
        <Field label="Are you pregnant?">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={pregnant}
              onChange={(e) => setPregnant(e.target.checked)}
              className="w-5 h-5"
            />
            Yes
          </label>
        </Field>
        <Field label="Any current injuries? (optional)">
          <textarea
            value={injuries}
            onChange={(e) => setInjuries(e.target.value)}
            className="w-full p-3 border border-stone rounded-md bg-white"
            rows={2}
          />
        </Field>
        <Field label="Emergency contact name">
          <input
            required
            type="text"
            value={emergencyName}
            onChange={(e) => setEmergencyName(e.target.value)}
            className="w-full p-3 border border-stone rounded-md bg-white"
          />
        </Field>
        <Field label="Emergency contact phone">
          <input
            required
            type="tel"
            value={emergencyPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
            className="w-full p-3 border border-stone rounded-md bg-white"
          />
        </Field>
        <button
          type="submit"
          disabled={submit.isPending}
          className="self-start px-8 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {submit.isPending ? 'Saving…' : 'Save and continue'}
        </button>
        {submit.error && <p className="text-error">{(submit.error as Error).message}</p>}
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}
