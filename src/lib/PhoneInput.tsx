import { COUNTRIES, type Country } from './phone';

export default function PhoneInput({ value, country, onChange, onCountry }: {
  value: string; country: Country; onChange: (v: string) => void; onCountry: (c: Country) => void;
}) {
  return (
    <label>
      Telefon
      <div className="phone">
        <select value={country} onChange={(e) => onCountry(e.target.value as Country)} aria-label="Land">
          {COUNTRIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="tel" autoComplete="tel"
          placeholder={country === 'ANNET' ? '+49 …' : ''} />
      </div>
    </label>
  );
}
