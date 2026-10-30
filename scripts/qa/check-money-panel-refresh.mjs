#!/usr/bin/env node
/* R-15: the "What is left to take" block must re-read when the account's ledgers are re-read, or a
   cost loaded on the account does not show until the person changes tab and comes back. */
import fs from 'node:fs'
const panel = fs.readFileSync('src/pages/accounts/MoneyPanel.tsx', 'utf8')
const detail = fs.readFileSync('src/pages/accounts/AccountDetail.tsx', 'utf8')
let bad = 0
const need = (ok, msg) => { if (!ok) { console.error('FAIL', msg); bad++ } }
need(/refreshKey/.test(panel) && /\[accountId, maySee, refreshKey\]/.test(panel), 'MoneyPanel.load must depend on refreshKey')
need(/<MoneyPanel accountId=\{account\.id\} refreshKey=\{ledgers\}/.test(detail), 'AccountDetail must pass the ledgers as refreshKey')
if (bad) process.exit(1)
console.log('2 passed, 0 failed')
