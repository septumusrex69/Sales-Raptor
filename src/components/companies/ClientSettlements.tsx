import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchClientSettlements, type ClientSettlement } from '../../lib/settlementApi'

/**
 * THE SETTLEMENTS THIS CLIENT ACCEPTED, ON THE CLIENT'S FILE -- AS LINKS, NOT COPIES (the firm, 11 Oct:
 * the acceptance should be on record "in the account and on the client's file. Perhaps it's better
 * just to live in the account").
 *
 * The proof lives once, on the account it settles. This lists the client's yeses with where each
 * one's writing is, so a liaison asked "did we agree R4 000 on Sipho's file?" finds it from the client
 * as well as from the debtor -- and a settlement with no proof on file says so.
 */
export function ClientSettlements({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<ClientSettlement[] | null>(null)
  useEffect(() => {
    let live = true
    void fetchClientSettlements(companyId).then((r) => { if (live) setRows(r) }).catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [companyId])
  if (!rows || rows.length === 0) return null
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-slate-800">Settlements this client accepted</h3>
        <p className="text-[12px] text-slate-500">Each one&rsquo;s written acceptance is on the debtor&rsquo;s account.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full list-table whitespace-nowrap" data-testid="client-settlements">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-1.5">
                  <Link to={`/accounts/${r.accountId}`} className="font-medium text-gold-700 hover:text-gold-800">
                    {r.accountNumber ?? r.caseNumber}
                  </Link>
                  <span className="ml-2 text-slate-600">{r.debtor}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{rand(r.amount)}</td>
                <td className="px-2 py-1.5 text-slate-500">
                  {r.status === 'paid' ? 'Paid' : r.expiresOn ? `Pay by ${formatDate(r.expiresOn)}` : ''}
                </td>
                <td className="px-4 py-1.5 max-w-[22rem] truncate text-slate-500" title={r.evidence ?? ''}>
                  {r.hasProof ? r.evidence : <span className="text-amber-700">No acceptance on file</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
