import type { StatementRow } from '@bolbill/shared';
import { rupees } from '@/lib/format';

interface Props {
  businessName: string;
  customerName: string;
  rows: readonly StatementRow[];
  /** Epoch ms the sheet was produced, shown at the top. */
  printedAt: number;
}

const date = (ms: number): string => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function label(row: StatementRow): string {
  const { entry } = row;
  if (entry.reversesEntryId) return `Reversal${entry.note ? `: ${entry.note}` : ''}`;
  if (entry.billId) return `Bill ${entry.billId.slice(0, 8)}`;
  return entry.type === 'payment' ? 'Payment mila' : 'Udhaar';
}

/**
 * A plain A4 customer statement. It is hidden on screen and shown only when printing (or saving as
 * PDF), so it needs no PDF library. It carries the customer's name and ledger, never their contact details.
 */
export function StatementSheet({ businessName, customerName, rows, printedAt }: Props) {
  const balance = rows.at(-1)?.balance ?? 0;
  return (
    <section className="bill-print-root hidden print:block" aria-hidden="true">
      <h1 className="text-xl font-bold">{businessName}</h1>
      <p>Hisab ka statement · {customerName}</p>
      <p className="mb-3 text-sm">{date(printedAt)}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2">Date</th>
            <th className="py-1 pr-2">Detail</th>
            <th className="py-1 pr-2 text-right">Udhaar</th>
            <th className="py-1 pr-2 text-right">Jama</th>
            <th className="py-1 text-right">Baaki</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entry.id} className="border-b border-gray-300">
              <td className="py-1 pr-2">{date(row.entry.createdAt)}</td>
              <td className="py-1 pr-2">{label(row)}</td>
              <td className="py-1 pr-2 text-right">{row.entry.type === 'udhaar' ? rupees(row.entry.amount) : ''}</td>
              <td className="py-1 pr-2 text-right">{row.entry.type === 'payment' ? rupees(row.entry.amount) : ''}</td>
              <td className="py-1 text-right">{rupees(row.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-lg font-bold">
        {balance > 0 ? `Kul baaki udhaar: ${rupees(balance)}` : balance < 0 ? `Advance (zyada diya): ${rupees(-balance)}` : 'Koi udhaar baaki nahi'}
      </p>
    </section>
  );
}
