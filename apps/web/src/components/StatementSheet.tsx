import type { StatementRow } from '@bolbill/shared';
import { rupees } from '@/lib/format';
import { useLocale, useT, type Translate } from '@/lib/i18n';

interface Props {
  businessName: string;
  customerName: string;
  rows: readonly StatementRow[];
  /** Epoch ms the sheet was produced, shown at the top. */
  printedAt: number;
}

const date = (ms: number, intlLocale: string): string => new Date(ms).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' });

function label(t: Translate, row: StatementRow): string {
  const { entry } = row;
  if (entry.reversesEntryId) return entry.note ? t('stmt.reversalNote', { note: entry.note }) : t('entry.reversal');
  if (entry.billId) return t('stmt.bill', { id: entry.billId.slice(0, 8) });
  return entry.type === 'payment' ? t('entry.paymentReceived') : t('entry.credit');
}

/**
 * A plain A4 customer statement. It is hidden on screen and shown only when printing (or saving as
 * PDF), so it needs no PDF library. It carries the customer's name and ledger, never their contact details.
 */
export function StatementSheet({ businessName, customerName, rows, printedAt }: Props) {
  const t = useT();
  const intl = useLocale().meta.intlLocale;
  const balance = rows.at(-1)?.balance ?? 0;
  return (
    <section className="bill-print-root hidden print:block" aria-hidden="true">
      <h1 className="text-xl font-bold">{businessName}</h1>
      <p>{t('stmt.title', { name: customerName })}</p>
      <p className="mb-3 text-sm">{date(printedAt, intl)}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2">{t('stmt.date')}</th>
            <th className="py-1 pr-2">{t('stmt.detail')}</th>
            <th className="py-1 pr-2 text-right">{t('entry.credit')}</th>
            <th className="py-1 pr-2 text-right">{t('stmt.paid')}</th>
            <th className="py-1 text-right">{t('stmt.balance')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entry.id} className="border-b border-gray-300">
              <td className="py-1 pr-2">{date(row.entry.createdAt, intl)}</td>
              <td className="py-1 pr-2">{label(t, row)}</td>
              <td className="py-1 pr-2 text-right">{row.entry.type === 'udhaar' ? rupees(row.entry.amount) : ''}</td>
              <td className="py-1 pr-2 text-right">{row.entry.type === 'payment' ? rupees(row.entry.amount) : ''}</td>
              <td className="py-1 text-right">{rupees(row.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-lg font-bold">
        {balance > 0 ? t('stmt.owed', { amount: rupees(balance) }) : balance < 0 ? t('stmt.advance', { amount: rupees(-balance) }) : t('stmt.none')}
      </p>
    </section>
  );
}
