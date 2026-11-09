import { creditDetailIssues, type DetailIssue } from '@bolbill/shared';
import type { Translate } from './i18n';

/** The sentence for one issue: what is wrong, with the numbers, and how to fix it. */
export function detailIssueText(t: Translate, issue: DetailIssue): string {
  switch (issue.code) {
    case 'nameMissing': return t('credit.err.nameMissing');
    case 'mobileEmpty': return t('credit.err.mobileEmpty');
    case 'mobileNotDigits': return t('credit.err.mobileNotDigits', { chars: issue.chars });
    case 'mobileShort': return t('credit.err.mobileShort', { count: issue.count, missing: issue.missing });
    case 'mobileLong': return t('credit.err.mobileLong', { count: issue.count, extra: issue.extra });
    case 'mobileStart': return t('credit.err.mobileStart', { digit: issue.digit });
    case 'addressEmpty': return t('credit.err.addressEmpty');
    case 'addressShort': return t('credit.err.addressShort', { count: issue.count, min: issue.min });
    case 'addressLong': return t('credit.err.addressLong', { count: issue.count, max: issue.max });
  }
}

export type DetailErrors = Partial<Record<'name' | 'mobile' | 'address', string>>;

/** One message per wrong field, ready to show under it. Empty when the details are good. */
export function detailErrors(t: Translate, input: { name: string; mobile: string; address: string }): DetailErrors {
  const out: DetailErrors = {};
  for (const issue of creditDetailIssues(input)) out[issue.field] ??= detailIssueText(t, issue);
  return out;
}
